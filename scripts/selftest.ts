import { app } from 'electron'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import E from 'eml-lib'
import { ConfigStore } from '../src/main/store'
import { AuthService } from '../src/main/auth'
import { ModService } from '../src/main/mods'
import { CrashService } from '../src/main/crash'
import { ModpackService } from '../src/main/modpack'
import { VersionService } from '../src/main/versions'
import { LibraryService } from '../src/main/library'
import { InstanceService } from '../src/main/instances'
import { LaunchService } from '../src/main/launch'
import { GameSettingsService } from '../src/main/game-settings'
import { defaultGameDir, ensureInstanceDirectory } from '../src/main/paths'
import type { InstanceRecord } from '../src/shared/types'

const root = path.join(os.tmpdir(), `ember-selftest-${Date.now()}`)
fs.mkdirSync(root, { recursive: true })
app.setPath('userData', path.join(root, 'userData'))

function ok(name: string, condition: boolean, extra = ''): void {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`)
  if (!condition) process.exitCode = 1
}

app.whenReady().then(async () => {
  console.log('=== EMBER core self-test ===')
  console.log('root:', root)

  const store = new ConfigStore(false)
  const cfg = store.load()
  ok('default config', cfg.schema === 1 && cfg.instances.length === 0 && cfg.theme === 'dark')

  const account = store.addAccount(
    { name: 'Selftest', uuid: '00000000-0000-0000-0000-000000000000', type: 'crack', online: false },
    { accessToken: 'a', clientToken: 'b', meta: { online: false, type: 'crack' } }
  )
  const secret = store.accountSecret(account.id)
  ok('account encryption round-trip', secret?.accessToken === 'a')
  ok('public account active', store.activeAccount()?.name === 'Selftest')

  const auth = new AuthService(store, () => null)
  const offline = auth.loginOffline('OfflineTester')
  ok('offline login', offline.type === 'crack' && store.activeAccount()?.name === 'OfflineTester')
  const created = store.createInstance({
    name: '涓枃娴嬭瘯瀹炰緥',
    mcVersion: '1.21.1',
    loader: { type: 'fabric', version: '0.16.10' }
  })
  ok('store create instance', store.get().instances.some((i) => i.id === created.id) && created.slug.length > 0, created.slug)
  const updated = store.updateInstance(created.id, { name: 'Renamed', overrides: { memoryMax: 6144 } })
  ok('store update instance', updated?.name === 'Renamed' && updated.overrides.memoryMax === 6144)
  store.removeInstance(created.id)
  ok('store remove instance', !store.get().instances.some((i) => i.id === created.id))

  store.updateGameOptions({ fov: '0.5', gamma: '0.25', renderClouds: 'true' })
  const optionsDir = path.join(root, 'options-test')
  fs.mkdirSync(optionsDir, { recursive: true })
  const optionsInstance = store.createInstance({
    name: 'Options Test',
    mcVersion: '1.21.1',
    loader: { type: 'vanilla', version: '1.21.1' },
    customDir: optionsDir
  })
  const gameSettings = new GameSettingsService(store)
  await gameSettings.applyDefaults(optionsInstance)
  const optionsFile = path.join(optionsDir, 'options.txt')
  const createdOptions = fs.readFileSync(optionsFile, 'utf8')
  ok(
    'unified options applied to new instance',
    createdOptions.includes('fov:0.5') &&
      createdOptions.includes('gamma:0.25') &&
      createdOptions.includes('renderClouds:"true"')
  )
  fs.writeFileSync(optionsFile, 'fov:70\nrenderDistance:8\n', 'utf8')
  await gameSettings.applyExisting([optionsInstance.id])
  const appliedOptions = fs.readFileSync(optionsFile, 'utf8')
  ok(
    'unified options applied to existing version',
    appliedOptions.includes('fov:0.5') && appliedOptions.includes('gamma:0.25') && appliedOptions.includes('renderDistance:8')
  )
  fs.rmSync(optionsFile)
  ok('unified options applied on first launch', await gameSettings.applyIfMissing(optionsInstance))
  ok('unified options not re-applied every launch', !(await gameSettings.applyIfMissing(optionsInstance)))
  store.removeInstance(optionsInstance.id)
  fs.rmSync(optionsDir, { recursive: true, force: true })
  store.updateGameOptions({})

  const instance: InstanceRecord = {
    id: 'selftest',
    name: 'Self Test',
    slug: 'selftest',
    description: 'fixture',
    emblem: 'S',
    accent: 'ember',
    mcVersion: '1.21.1',
    loader: { type: 'fabric', version: '0.16.10' },
    overrides: {},
    modOrder: [],
    customDir: path.join(root, 'game'),
    playtimeMs: 0,
    createdAt: Date.now()
  }
  const game = instance.customDir!
  fs.mkdirSync(path.join(game, 'mods'), { recursive: true })
  fs.mkdirSync(path.join(game, 'mods-disabled'), { recursive: true })
  const zip = new AdmZip()
  zip.addFile(
    'fabric.mod.json',
    Buffer.from(
      JSON.stringify({
        id: 'betterclouds',
        name: 'Better Clouds',
        version: '2.4.1',
        description: 'cloud fixture',
        authors: ['Tester'],
        icon: 'icon.png'
      })
    )
  )
  zip.addFile('icon.png', Buffer.from([137, 80, 78, 71]))
  zip.writeZip(path.join(game, 'mods', 'betterclouds-2.4.1.jar'))

  const mods = new ModService(false)
  const scan = await mods.scan(instance)
  ok('mod scan count', scan.enabledCount === 1 && scan.mods.length === 1)
  ok('mod metadata', scan.mods[0]?.id === 'betterclouds' && scan.mods[0]?.name === 'Better Clouds')
  ok('mod icon data url', (scan.mods[0]?.icon ?? '').startsWith('data:image/png;base64'))
  ok('mod invalid false', scan.mods[0]?.invalid === false)

  fs.mkdirSync(path.join(game, 'crash-reports'), { recursive: true })
  fs.mkdirSync(path.join(game, 'logs'), { recursive: true })
  const crashText = `---- Minecraft Crash Report ----
// Ember self test

Time: 2026-10-22 19:00:00
Description: Mixin apply failed

java.lang.RuntimeException: Mixin transformation failed
Caused by: org.spongepowered.asm.mixin.injection.throwables.InvalidInjectionException: @Inject cancel
\tat betterclouds.mixin.CloudRendererMixin.injectFog(CloudRendererMixin.java:87)
\tat net.minecraft.client.renderer.LevelRenderer.renderLevel(LevelRenderer.java:1192)
Caused by: java.lang.NoSuchMethodError: com.foo.render.RenderPipeline.pushFog
\tat betterclouds.render.RenderPipeline.pushFog(RenderPipeline.java:214)

-- System Details --
Minecraft Version: 1.21.1
Java Version: 21.0.8, Microsoft, 64-bit
Memory: 4096 MB / 8192 MB
`
  fs.writeFileSync(path.join(game, 'crash-reports', 'crash-2026-10-22_19.00.00-client.txt'), crashText)
  fs.writeFileSync(path.join(game, 'logs', 'latest.log'), crashText)

  const crash = new CrashService(mods, false)
  const sources = await crash.sources(instance)
  ok('crash sources', sources.length >= 2 && !!sources.find((s) => s.kind === 'crash-report'))
  const analysis = await crash.analyze(instance)
  ok('crash headline', /Mixin|娉ㄥ叆/.test(analysis.headline), analysis.headline)
  ok('crash findings', analysis.findings.some((f) => f.severity === 'critical'))
  ok('crash suspects', analysis.suspects.length > 0 && analysis.suspects[0].className.includes('betterclouds'))
  ok('crash checks', analysis.checks.some((c) => c.id === 'duplicates') && analysis.checks.some((c) => c.id === 'java'))
  ok('crash memory finding', analysis.findings.some((f) => f.id === 'java-mismatch') === false)

  const demoCrash = await new CrashService(mods, true).analyze(instance)
  ok('demo crash', demoCrash.severity === 'critical' && demoCrash.suspects.length === 3)

  fs.writeFileSync(
    path.join(root, 'modpack.json'),
    JSON.stringify({
      name: 'Fixture Pack',
      minecraftVersion: '1.21.1',
      loader: { loader: 'fabric', version: '0.16.10' },
      files: [
        { path: 'mods/a.jar', url: 'https://example.com/a.jar', sha1: 'x', size: 123 },
        { path: 'config/test.json', url: 'https://example.com/test.json', sha1: 'y', size: 10 }
      ]
    })
  )
  const modpack = new ModpackService()
  const info = await modpack.inspect({ kind: 'local', localPath: path.join(root, 'modpack.json') })
  ok('modpack inspect', info.valid && info.fileCount === 2 && info.suggestedMcVersion === '1.21.1')
  const manifestUrl = await modpack.manifestUrl({ kind: 'local', localPath: path.join(root, 'modpack.json') })
  ok('local manifest server', !!manifestUrl && manifestUrl.startsWith('http://127.0.0.1:'))
  const fetched = manifestUrl ? await fetch(manifestUrl).then((r) => r.json()) : null
  ok('local manifest serve', fetched?.name === 'Fixture Pack')
  modpack.dispose()

  const versions = new VersionService()
  const mc = await versions.minecraft()
  ok('mojang versions', mc.length > 100 && mc.some((v) => v.type === 'release'), `latest=${mc[0]?.id}`)
  const fabric = await versions.loaders('1.21.1', 'fabric')
  ok('fabric loader versions', fabric.length > 0, `first=${fabric[0]?.version}`)
  const forge = await versions.loaders('1.20.1', 'forge')
  ok('forge loader versions', forge.length > 0, `first=${forge[0]?.version}`)
  const neo = await versions.loaders('1.21.1', 'neoforge')
  ok('neoforge loader metadata', neo.some((v) => v.version.startsWith('21.1.')), `first=${neo[0]?.version}`)
  const neo26 = await versions.loaders('26.3', 'neoforge')
  ok('neoforge 26.x metadata', neo26.some((v) => v.version.startsWith('26.3.')), `first=${neo26[0]?.version}`)
  const java = await versions.detectJava()
  console.log('java detected:', java.map((j) => `${j.vendor} ${j.major} ${j.path}`).join(' | ') || '(none)')

  const junctionInstance: InstanceRecord = {
    ...instance,
    id: 'junction',
    slug: `junction-test-${Date.now().toString(36)}`,
    customDir: path.join(root, 'junction-target')
  }
  const junctionLink = await ensureInstanceDirectory(junctionInstance)
  const real = await fsp.realpath(junctionLink).catch(() => '')
  ok('custom instance junction', path.resolve(real) === path.resolve(junctionInstance.customDir), `${junctionLink} -> ${real}`)
  ok('junction points at default EML path', junctionLink === defaultGameDir(junctionInstance.slug))
  await fsp.unlink(junctionLink).catch(() => undefined)
  await fsp.rm(junctionInstance.customDir!, { recursive: true, force: true }).catch(() => undefined)

  const launcher = new E.Launcher({
    root: 'ember',
    storage: 'isolated',
    account: new E.CrackAuth().auth('TestUser'),
    profile: { slug: 'selftest', minecraft: { version: '1.21.1' } },
    cleaning: { enabled: false }
  })
  ok('EML resolved root', launcher.config.root.replace(/\\/g, '/').endsWith('/.ember/selftest'), launcher.config.root)
  ok('EML cleaning disabled', launcher.config.cleaning.enabled === false)

  let importedInput: Record<string, unknown> | null = null
  const fakeInstances = {
    create: async (input: Record<string, unknown>) => {
      importedInput = input
      return { id: 'imported', ...input } as never
    }
  } as unknown as InstanceService
  const library = new LibraryService(store, fakeInstances)
  const libraryScan = await library.scan()
  const pclForge = libraryScan.versions.find((v) => v.id === '1.20.1-Forge_47.4.22')
  const pclNeo = libraryScan.versions.find((v) => v.id === '1.21.1-NeoForge_21.1.248')
  ok('local library scan', libraryScan.versions.length > 0 && libraryScan.roots.length > 0, `versions=${libraryScan.versions.length}`)
  ok(
    'PCL forge version parsed',
    !!pclForge &&
      pclForge.mcVersion === '1.20.1' &&
      pclForge.loader.type === 'forge' &&
      pclForge.loader.version === '47.4.22' &&
      pclForge.launcher === 'pcl' &&
      pclForge.isolated &&
      pclForge.gameDir === pclForge.versionDir,
    pclForge ? `${pclForge.mcVersion} / ${pclForge.loader.type} ${pclForge.loader.version} / ${pclForge.launcher}` : 'not found'
  )
  ok(
    'PCL neoforge version parsed',
    !!pclNeo &&
      pclNeo.mcVersion === '1.21.1' &&
      pclNeo.loader.type === 'neoforge' &&
      pclNeo.loader.version === '21.1.248' &&
      pclNeo.hasJar,
    pclNeo ? `${pclNeo.mcVersion} / ${pclNeo.loader.type} ${pclNeo.loader.version}` : 'not found'
  )
  const vanilla = libraryScan.versions.find((v) => v.id === '26.3')
  if (vanilla) {
    ok('missing client jar rejected', await library.import({ rootPath: vanilla.rootPath, versionId: vanilla.id, name: 'No Jar' }).then(() => false, () => true))
  }
  if (pclNeo) {
    await library.import({ rootPath: pclNeo.rootPath, versionId: pclNeo.id, name: 'Imported Neo' })
    ok('local import points at original root', importedInput?.importedFrom === pclNeo.rootPath && importedInput?.customDir === undefined)
    ok('local import remembers version dir', importedInput?.localVersionId === pclNeo.id && importedInput?.localVersionDir === pclNeo.versionDir)

    const realLaunch = new LaunchService(store, auth, new ModpackService(), versions, () => undefined, () => undefined, false)
    const realInstances = new InstanceService(store, realLaunch, mods, new GameSettingsService(store), false)
    const realLibrary = new LibraryService(store, realInstances)
    const imported = await realLibrary.import({ rootPath: pclNeo.rootPath, versionId: pclNeo.id, name: 'Local Test Instance' })
    ok(
      'real import creates local instance',
      !imported.isCustomDir &&
        imported.gameDir === pclNeo.versionDir &&
        imported.localVersionDir === pclNeo.versionDir &&
        imported.resolvedLaunchMode === 'local',
      imported.gameDir
    )
    ok(
      'local import does not junction .minecraft',
      !(await fsp.lstat(defaultGameDir(imported.slug)).then((s) => s.isSymbolicLink()).catch(() => false))
    )
    ok('PCL mods resolve to version folder', (await mods.quickCounts(realInstances.find(imported.id))).mods > 0)
    await realInstances.remove(imported.id)
    ok('real import removal keeps target', await fsp.access(pclNeo.rootPath).then(() => true).catch(() => false))
  }

  await fsp.rm(root, { recursive: true, force: true }).catch(() => undefined)
  console.log('=== done ===')
  app.quit()
})

app.on('window-all-closed', () => undefined)

