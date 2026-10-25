import { app, BrowserWindow, Menu, Tray, nativeImage, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ConfigStore } from './store'
import { AuthService } from './auth'
import { VersionService } from './versions'
import { ModService } from './mods'
import { ModLibraryService } from './mod-library'
import { MaintenanceService } from './maintenance'
import { GameUpdateService } from './game-updates'
import { UpdateService } from './update-service'
import { ModpackService } from './modpack'
import { LaunchService } from './launch'
import { CrashService } from './crash'
import { SkinService } from './skin'
import { InstanceService } from './instances'
import { LibraryService } from './library'
import { GameSettingsService } from './game-settings'
import { ModrinthService } from './modrinth'
import { installDownloadOptimizer, configureDownload } from './download-optimizer'
import emlLoader from 'eml-lib/lib/utils/loader.js'
import { gameDataDirFor } from './paths'
import { registerIpc } from './ipc'
import type { LaunchEvent, Settings } from '../shared/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const demo = process.argv.includes('--demo') || process.env.EMBER_DEMO === '1'
const smoke = process.argv.includes('--smoke')

app.setName('ELYTRA')
const appDataRoot = app.getPath('appData')
const legacyData = path.join(appDataRoot, 'EMBER Launcher')
const dataDir = process.env.ELYTRA_USER_DATA
  ? path.resolve(process.env.ELYTRA_USER_DATA)
  : path.join(appDataRoot, 'ELYTRA')
if (!process.env.ELYTRA_USER_DATA && !fs.existsSync(dataDir) && fs.existsSync(legacyData)) {
  try {
    fs.renameSync(legacyData, dataDir)
  } catch {
    try {
      fs.cpSync(legacyData, dataDir, { recursive: true })
    } catch (err) {
      console.warn('[data] failed to migrate legacy directory:', err)
    }
  }
}
fs.mkdirSync(dataDir, { recursive: true })
const effectiveDataDir =
  !process.env.ELYTRA_USER_DATA &&
  !fs.existsSync(path.join(dataDir, 'ember-config.json')) &&
  fs.existsSync(path.join(legacyData, 'ember-config.json'))
    ? legacyData
    : dataDir
fs.mkdirSync(effectiveDataDir, { recursive: true })
app.setPath('userData', effectiveDataDir)
app.setAppUserModelId('com.qdq.elytra')

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let store: ConfigStore
let launch: LaunchService
let disposeServices: (() => void) | null = null

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
    const index = commandLine.indexOf('--instance')
    const instanceId = index >= 0 ? commandLine[index + 1] : undefined
    if (instanceId && store) {
      store.setActiveInstance(instanceId)
      if (commandLine.includes('--launch') && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('app:auto-launch', instanceId)
      }
    }
  })
}

function trayIcon(): Electron.NativeImage | null {
  const candidates = [
    path.join(process.resourcesPath, 'tray.png'),
    path.join(app.getAppPath(), 'build', 'tray.png'),
    path.join(app.getAppPath(), 'build', 'icon.png')
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const image = nativeImage.createFromPath(candidate)
      if (!image.isEmpty()) return image.resize({ width: 18, height: 18 })
    }
  }
  return null
}

function ensureTray(): void {
  if (tray) return
  const image = trayIcon()
  if (!image) return
  tray = new Tray(image)
  tray.setToolTip('ELYTRA')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '显示 ELYTRA',
        click: () => {
          mainWindow?.show()
          mainWindow?.focus()
        }
      },
      {
        label: '游戏仍在运行',
        enabled: false
      },
      { type: 'separator' },
      {
        label: '退出启动器',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('double-click', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
}

function afterSpawn(settings: Settings): void {
  if (!mainWindow) return
  if (settings.afterLaunch === 'minimize') {
    mainWindow.minimize()
  } else if (settings.afterLaunch === 'tray') {
    ensureTray()
    if (tray) {
      mainWindow.hide()
      if (process.platform === 'win32') {
        tray.displayBalloon?.({
          title: 'Minecraft 已启动',
          content: 'ELYTRA 已收起到系统托盘，双击托盘图标可以重新打开。',
          iconType: 'info'
        })
      }
    } else {
      mainWindow.minimize()
    }
  } else {
    mainWindow.show()
    mainWindow.focus()
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    frame: false,
    icon: path.join(app.getAppPath(), 'build', 'icon.png'),
    backgroundColor: '#080607',
    roundedCorners: true,
    autoHideMenuBar: true,
    title: 'ELYTRA',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false
    }
  })
  win.removeMenu()

  win.on('ready-to-show', () => {
    win.show()
    win.focus()
  })
  win.on('maximize', () => win.webContents.send('window:maximized', true))
  win.on('unmaximize', () => win.webContents.send('window:maximized', false))
  win.on('close', (event) => {
    const state = launch.getState()
    if (!quitting && ['launching', 'running'].includes(state.status)) {
      event.preventDefault()
      ensureTray()
      if (tray) win.hide()
      else win.minimize()
      return
    }
  })
  win.on('closed', () => {
    mainWindow = null
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const allowedDev = process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL)
    if (!allowedDev && !url.startsWith('file://')) event.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  return win
}

async function captureSmoke(win: BrowserWindow): Promise<void> {
  const dir = path.join(process.cwd(), 'screenshots')
  fs.mkdirSync(dir, { recursive: true })
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const snap = async (name: string, keepScroll = false) => {
    if (!keepScroll) {
      await win.webContents.executeJavaScript("document.querySelector('.content-scroll')?.scrollTo({top:0,behavior:'auto'})")
    }
    await wait(260)
    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(dir, `${name}.png`), image.toPNG())
    console.log('[smoke] wrote', path.join(dir, `${name}.png`))
  }
  await wait(700)
  await snap('00-splash-dark')
  await wait(3300)
  await snap('01-home-dark')
  await win.webContents.executeJavaScript("document.querySelectorAll('.instance-row')[1]?.click()")
  await wait(800)
  await snap('01b-home-local-dark')
  await win.webContents.executeJavaScript("window.__emberSmoke?.navigate('/instance/crimson-depths')")
  await wait(2600)
  await snap('02-instance-settings-dark')
  await win.webContents.executeJavaScript("document.querySelectorAll('.settings-tabs button')[1]?.click()")
  await wait(700)
  await snap('02b-memory-dark')
  await win.webContents.executeJavaScript("document.querySelectorAll('.settings-tabs button')[2]?.click()")
  await wait(1600)
  await snap('02c-java-dark')
  await win.webContents.executeJavaScript("document.querySelectorAll('.settings-tabs button')[3]?.click()")
  await wait(600)
  await snap('02d-advanced-dark')
  await win.webContents.executeJavaScript("document.querySelectorAll('.settings-tabs button')[4]?.click()")
  await wait(600)
  await snap('02e-directory-dark')
  await win.webContents.executeJavaScript("window.__emberSmoke?.navigate('/instance/frostbound')")
  await wait(1300)
  await snap('02f-local-mode-dark')
  await win.webContents.executeJavaScript("window.__emberSmoke?.navigate('/skin')")
  await wait(2200)
  await snap('03-skin-dark')
  await win.webContents.executeJavaScript("window.__emberSmoke?.navigate('/mods')")
  await wait(1700)
  await snap('04-mods-dark')
  await win.webContents.executeJavaScript("Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('模组库'))?.click()")
  await wait(700)
  await snap('04b-mod-library-dark')
  await win.webContents.executeJavaScript("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
  await wait(300)
  await win.webContents.executeJavaScript("window.__emberSmoke?.navigate('/crash')")
  await wait(1800)
  await snap('05-crash-dark')
  await win.webContents.executeJavaScript("document.querySelectorAll('.crash-tabs button')[1]?.click()")
  await wait(550)
  await snap('05b-crash-suspects-dark')
  await win.webContents.executeJavaScript("window.__emberSmoke?.navigate('/modpack')")
  await wait(1400)
  await snap('06-modpack-dark')
  await win.webContents.executeJavaScript("window.__emberSmoke?.navigate('/discover')")
  await wait(2400)
  await snap('06b-discover-dark')
  await win.webContents.executeJavaScript("document.querySelector('.version-select .select-trigger')?.click()")
  await wait(400)
  await snap('06c-discover-dropdown')
  await win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  await wait(250)
  await win.webContents.executeJavaScript("window.__emberSmoke?.navigate('/settings')")
  await wait(1300)
  await snap('07-settings-dark')
  await win.webContents.executeJavaScript("document.querySelector('.content-scroll')?.scrollTo({ top: 99999, behavior: 'auto' })")
  await wait(500)
  await snap('07c-download-settings-dark', true)
  await win.webContents.executeJavaScript("window.__emberSmoke?.navigate('/game')")
  await wait(900)
  await snap('07b-game-settings-dark')
  await win.webContents.executeJavaScript("Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('应用到已有版本'))?.click()")
  await wait(500)
  await snap('07d-game-apply-dark')
  await win.webContents.executeJavaScript("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
  await wait(300)
  await win.webContents.executeJavaScript("window.__emberSmoke?.setTheme('light'); window.__emberSmoke?.navigate('/')")
  await wait(1800)
  await snap('08-home-light')
  await win.webContents.executeJavaScript("window.__emberSmoke?.openCreate()")
  await wait(1000)
  await snap('09-create-light')
  await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('.create-form .text-input.big');
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Aurora Drift');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const buttons = document.querySelectorAll('.create-foot-actions .btn');
    buttons[buttons.length - 1]?.click();
  })()`)
  await wait(2200)
  await snap('09b-create-step2-light')
  await win.webContents.executeJavaScript("document.querySelectorAll('.create-foot-actions .btn')[document.querySelectorAll('.create-foot-actions .btn').length - 1]?.click()")
  await wait(800)
  await snap('09c-create-step3-light')
  await win.webContents.executeJavaScript("window.__emberSmoke?.closeAll(); window.__emberSmoke?.setTheme('dark'); window.__emberSmoke?.navigate('/')")
  await wait(1200)
  await win.webContents.executeJavaScript("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))")
  await wait(500)
  await snap('10-command-dark')
  await win.webContents.executeJavaScript("window.__emberSmoke?.closeAll()")
  await wait(300)
  await win.webContents.executeJavaScript("window.__emberSmoke?.openImport()")
  await wait(1600)
  await snap('11-import-game-dark')
  await win.webContents.executeJavaScript("window.__emberSmoke?.closeAll()")
  await wait(300)
  await win.webContents.executeJavaScript("window.__emberSmoke?.openAccount()")
  await wait(900)
  await snap('12-account-dark')
  await win.webContents.executeJavaScript("window.__emberSmoke?.closeAll(); window.__emberSmoke?.setTheme('dark'); window.__emberSmoke?.navigate('/')")
  await wait(1200)
  await win.webContents.executeJavaScript("window.__emberSmoke?.launchDemo()")
  await wait(2100)
  await snap('13-launch-sequence')
  await wait(3600)
  await snap('14-launch-running')
  console.log('[smoke] done')
  quitting = true
  app.quit()
}

async function captureSkin(win: BrowserWindow, store: ConfigStore, original: string | null): Promise<void> {
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  await wait(2600)
  await win.webContents.executeJavaScript("window.__emberSmoke?.navigate('/skin')")
  await wait(2600)
  const image = await win.webContents.capturePage()
  const dir = path.join(process.cwd(), 'screenshots')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, '15-skin-local.png'), image.toPNG())
  console.log('[capture] wrote', path.join(dir, '15-skin-local.png'))
  await win.webContents.executeJavaScript("window.__emberSmoke?.navigate('/settings'); document.querySelector('.content-scroll')?.scrollTo({ top: 0, behavior: 'auto' })")
  await wait(900)
  const scheduleImage = await win.webContents.capturePage()
  fs.writeFileSync(path.join(dir, '15b-theme-schedule.png'), scheduleImage.toPNG())
  console.log('[capture] wrote', path.join(dir, '15b-theme-schedule.png'))
  if (original) store.setActiveInstance(original)
  quitting = true
  app.quit()
}

async function runFeatureTest(
  store: ConfigStore,
  skin: SkinService,
  modrinth: ModrinthService,
  instances: InstanceService,
  modpack: ModpackService,
  crash: CrashService
): Promise<void> {
  const results: string[] = []
  const check = (name: string, ok: boolean, detail: string) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`)
  try {
    const poInstance = store.get().instances.find((item) => item.slug === 'po')
    if (poInstance) {
      const crashInfo = await crash.analyze(poInstance)
      check(
        'crash-log-context',
        crashInfo.findings.some((item) => item.id === 'missing-dependency' && /fabric-api/i.test(item.title)),
        `${crashInfo.findings[0]?.title ?? crashInfo.headline} / ${crashInfo.sourceKind}`
      )
    }
    const maintenance = new MaintenanceService(store, demo)
    const cleanupGroups = await maintenance.scan()
    check(
      'maintenance-scan',
      cleanupGroups.length >= 6 && cleanupGroups.every((group) => typeof group.count === 'number'),
      cleanupGroups.map((group) => `${group.id}:${group.count}`).join(' ')
    )
    const installer = await emlLoader.getInstaller({
      minecraft: { version: '1.20.1', loader: { loader: 'forge', version: '47.4.28' } }
    })
    check('forge-installer', /1\.20\.1-47\.4\.28/.test(installer.name) && Number(installer.size) > 1_000_000, `${installer.name} ${installer.url}`)
  } catch (err) {
    check('forge-installer', false, err instanceof Error ? err.message : String(err))
  }

  const original = store.get().activeInstanceId
  const csl = store.get().instances.find((item) => item.name.includes('1.21.1-NeoForge'))
  if (csl) {
    try {
      store.setActiveInstance(csl.id)
      const bundle = await skin.get()
      check(
        'customskinloader',
        !!bundle.local?.detected && /1\.21\.1-NeoForge/.test(bundle.local.skinDir ?? '') && /LocalSkin\\capes/.test(bundle.local.capeDir ?? ''),
        `mode=${bundle.mode} skin=${bundle.local?.skinDir} cape=${bundle.local?.capeDir} mod=${bundle.local?.modFile}`
      )
    } catch (err) {
      check('customskinloader', false, err instanceof Error ? err.message : String(err))
    } finally {
      if (original) store.setActiveInstance(original)
    }
  } else {
    check('customskinloader', false, '没有 1.21.1-NeoForge 实例')
  }

  try {
    const tags = await modrinth.tags()
    check('modrinth-tags', tags.loaders.length > 3 && tags.gameVersions.some((item) => item.version === '1.20.1'), `${tags.loaders.length} loaders / ${tags.gameVersions.length} versions`)
    const search = await modrinth.search({ query: 'jei', type: 'mod', loader: 'forge', gameVersion: '1.20.1', limit: 3 })
    check('modrinth-search', search.hits.length > 0, `${search.hits.length} hits / ${search.hits[0]?.title ?? 'none'}`)
    if (search.hits[0]) {
      const versions = await modrinth.versions(search.hits[0].project_id, { loader: 'forge', gameVersion: '1.20.1' })
      check('modrinth-versions', versions.length > 0, `${versions.length} versions / ${versions[0]?.version_number ?? 'none'}`)
    }
  } catch (err) {
    check('modrinth-api', false, err instanceof Error ? err.message : String(err))
  }

  try {
    const sample = path.join(process.env.USERPROFILE ?? '', 'Downloads', 'the_shooting_star-10', 'manifest.json')
    if (fs.existsSync(sample)) {
      const info = await modpack.inspect({ kind: 'local', localPath: sample })
      check(
        'modpack-curseforge-inspect',
        info.format === 'curseforge' && info.valid && info.fileCount > 50 && info.suggestedLoader?.type === 'fabric' && info.suggestedMcVersion === '26.3',
        `${info.format} ${info.fileCount} files ${info.suggestedLoader?.type}:${info.suggestedLoader?.version} mc=${info.suggestedMcVersion}`
      )
      if (process.env.ELYTRA_TEST_FULL_PACK === '1') {
        const fullUrl = await modpack.manifestUrl({ kind: 'local', localPath: sample })
        const full = fullUrl ? await fetch(fullUrl) : null
        const normalizedFull = full?.ok ? ((await full.json()) as { files?: unknown[] }) : null
        check('modpack-curseforge-full', (normalizedFull?.files?.length ?? 0) >= info.fileCount, `${normalizedFull?.files?.length ?? 0}/${info.fileCount} files`)
      }
    }
    const elytraExport = path.join(app.getPath('desktop'), '1.21.1-NeoForge_21.1.248-manifest.json')
    if (fs.existsSync(elytraExport)) {
      const exported = await modpack.inspect({ kind: 'local', localPath: elytraExport })
      check(
        'modpack-elytra-export',
        exported.format === 'elytra' && exported.valid && exported.fileCount > 0 && exported.suggestedMcVersion === '1.21.1',
        `${exported.format} ${exported.fileCount} files ${exported.suggestedLoader?.type}`
      )
    }
    const tempManifest = path.join(process.env.TEMP ?? process.cwd(), 'elytra-cf-test.json')
    fs.writeFileSync(
      tempManifest,
      JSON.stringify({
        manifestType: 'minecraftModpack',
        manifestVersion: 1,
        name: 'CF test',
        version: '1',
        minecraft: { version: '26.3', modLoaders: [{ id: 'fabric-0.19.5', primary: true }] },
        files: [
          { projectID: 226375, fileID: 9139602, required: true },
          { projectID: 1345706, fileID: 9097562, required: true },
          { projectID: 915201, fileID: 7125700, required: true },
          { projectID: 1358098, fileID: 8170276, required: true }
        ]
      })
    )
    const url = await modpack.manifestUrl({ kind: 'local', localPath: tempManifest })
    const response = url ? await fetch(url) : null
    const normalized = response?.ok ? ((await response.json()) as { files?: { name?: string; url?: string; path?: string }[] }) : null
    check(
      'modpack-curseforge-resolve',
      !!normalized?.files && normalized.files.length === 4 && normalized.files.every((file) => !!file.name && /^https:\/\/mediafilez\.forgecdn\.net\/files\//.test(file.url ?? '') && /^(mods|resourcepacks|shaderpacks)\/$/.test(file.path ?? '')),
      `${normalized?.files?.length ?? 0} files ${normalized?.files?.[0]?.url ?? ''}`
    )
    if (normalized?.files?.length) {
      // The shape is validated above; EML joins path + name, so keep both fields present.
    }
    fs.rmSync(tempManifest, { force: true })
  } catch (err) {
    check('modpack-curseforge', false, err instanceof Error ? err.message : String(err))
  }

  const target = store.get().instances.find((item) => item.name === '1.20.1')
  if (target) {
    const manifestPath = path.join(gameDataDirFor(target), '.ember-modrinth.json')
    const before = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, 'utf8') : null
    try {
      const updates = await modrinth.simulateUpdate(target.id)
      check('modrinth-simulated-update', updates.length > 0, `${updates.length} updates / ${updates[0]?.title ?? 'none'}`)
    } catch (err) {
      check('modrinth-simulated-update', false, err instanceof Error ? err.message : String(err))
    } finally {
      if (before === null) fs.rmSync(manifestPath, { force: true })
      else fs.writeFileSync(manifestPath, before)
    }
    try {
      const rp = await modrinth.search({ query: 'BSL Minipacks', type: 'resourcepack', gameVersion: '1.20.1', limit: 1 })
      const hit = rp.hits[0]
      if (!hit) throw new Error('没有找到测试材质包')
      const downloaded = await modrinth.download(target.id, hit.project_id, hit.title, 'resourcepack')
      check('modrinth-download', fs.existsSync(downloaded.path) && fs.statSync(downloaded.path).size > 1000, `${downloaded.fileName} ${fs.statSync(downloaded.path).size} bytes`)
      fs.rmSync(downloaded.path, { force: true })
    } catch (err) {
      check('modrinth-download', false, err instanceof Error ? err.message : String(err))
    } finally {
      if (before === null) fs.rmSync(manifestPath, { force: true })
      else fs.writeFileSync(manifestPath, before)
    }
    try {
      const search = await modrinth.search({ query: 'jei', type: 'mod', loader: 'forge', gameVersion: '1.20.1', limit: 1 })
      const hit = search.hits[0]
      if (!hit) throw new Error('没有找到测试模组')
      const versions = await modrinth.versions(hit.project_id, { loader: 'forge', gameVersion: '1.20.1' })
      if (!versions[0]) throw new Error('没有测试模组版本')
      let progressThreads = 0
      let progressSpeed = 0
      const downloaded = await modrinth.download(target.id, hit.project_id, hit.title, 'mod', versions[0].id, undefined, (progress) => {
        if (progress.speed > 0) progressSpeed = progress.speed
        progressThreads = Math.max(progressThreads, progress.threads)
      })
      check('modrinth-parallel-download', fs.statSync(downloaded.path).size > 1_000_000 && progressThreads > 1 && progressSpeed > 0, `${downloaded.fileName} ${fs.statSync(downloaded.path).size} bytes · ${progressThreads} threads`)
      fs.rmSync(downloaded.path, { force: true })
    } catch (err) {
      check('modrinth-parallel-download', false, err instanceof Error ? err.message : String(err))
    } finally {
      if (before === null) fs.rmSync(manifestPath, { force: true })
      else fs.writeFileSync(manifestPath, before)
    }
    try {
      const exportDir = path.join(process.env.TEMP ?? process.cwd(), 'elytra-export-test')
      fs.rmSync(exportDir, { force: true, recursive: true })
      process.env.ELYTRA_EXPORT_DIR = exportDir
      const info = await instances.exportInfo(target.id)
      const list = await instances.exportModrinthList(target.id)
      const cfManifestPath = await instances.exportModpackManifest(target.id)
      const packPath = await instances.exportModpackZip(target.id)
      const manifestJson = cfManifestPath ? JSON.parse(fs.readFileSync(cfManifestPath, 'utf8')) : null
      check(
        'export-info-modrinth',
        !!info && fs.existsSync(info) && fs.readFileSync(info, 'utf8').includes('Minecraft：1.20.1') && !!list && fs.existsSync(list) && !!JSON.parse(fs.readFileSync(list, 'utf8')).files,
        `${info ?? 'no info'} / ${list ?? 'no list'}`
      )
      check(
        'export-curseforge',
        manifestJson?.manifestType === 'minecraftModpack' &&
          manifestJson?.minecraft?.version === '1.20.1' &&
          Array.isArray(manifestJson?.files) &&
          Array.isArray(manifestJson?.elytraFiles) &&
          !!packPath &&
          fs.existsSync(packPath) &&
          fs.statSync(packPath).size > 100,
        `${cfManifestPath ?? 'no manifest'} / ${packPath ?? 'no pack'}`
      )
      const saves = path.join(gameDataDirFor(target), 'saves')
      const existing = fs.existsSync(saves)
      fs.mkdirSync(saves, { recursive: true })
      fs.mkdirSync(path.join(saves, 'elytra-export-test'), { recursive: true })
      fs.writeFileSync(path.join(saves, 'elytra-export-test', 'level.dat'), 'export test')
      const zip = await instances.exportSaves(target.id)
      check('export-saves', !!zip && fs.existsSync(zip) && fs.statSync(zip).size > 100, zip ?? 'no zip')
      fs.rmSync(path.join(saves, '.elytra-export-test.txt'), { force: true })
      if (!existing) fs.rmSync(saves, { force: true, recursive: true })
      fs.rmSync(exportDir, { force: true, recursive: true })
      delete process.env.ELYTRA_EXPORT_DIR
    } catch (err) {
      delete process.env.ELYTRA_EXPORT_DIR
      check('export-info-modrinth', false, err instanceof Error ? err.message : String(err))
    }
  } else {
    check('modrinth-simulated-update', false, '没有 1.20.1 实例')
  }

  console.log('[feature-test]\n' + results.join('\n'))
}

app.whenReady().then(async () => {
  installDownloadOptimizer()
  store = new ConfigStore(demo)
  store.load()
  const shortcutInstance = process.argv.indexOf('--instance')
  if (shortcutInstance >= 0 && process.argv[shortcutInstance + 1]) {
    store.setActiveInstance(process.argv[shortcutInstance + 1])
  }
  configureDownload({
    threads: store.get().global.downloadThreads,
    smartMirror: store.get().global.smartDownload,
    maxSpeed: store.get().global.downloadLimit * 1024 * 1024
  })
  const versions = new VersionService()
  const mods = new ModService(demo)
  const modLibrary = new ModLibraryService(demo)
  const maintenance = new MaintenanceService(store, demo)
  const gameUpdates = new GameUpdateService()
  const updates = new UpdateService()
  const modpackService = new ModpackService()
  const auth = new AuthService(store, () => mainWindow)
  const modrinth = new ModrinthService(store)
  const skin = new SkinService(auth, store, modrinth)
  const crash = new CrashService(mods, demo)

  const captureSkinFlag = process.argv.includes('--capture-skin')
  const captureOriginal = captureSkinFlag ? store.get().activeInstanceId : null
  if (captureSkinFlag) {
    const target = store.get().instances.find((item) => item.name.includes('1.21.1-NeoForge'))
    if (target) store.setActiveInstance(target.id)
  }

  mainWindow = createWindow()
  launch = new LaunchService(
    store,
    auth,
    modpackService,
    versions,
    (event: LaunchEvent) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('launch:event', event)
      }
    },
    afterSpawn,
    demo,
    skin
  )
  const gameSettings = new GameSettingsService(store)
  const instanceService = new InstanceService(store, launch, mods, gameSettings, demo)
  const library = new LibraryService(store, instanceService)
  if (!demo) await library.migrateLegacyImports().catch((err) => console.warn('[library] migrate failed:', err))

  registerIpc({
    store,
    auth,
    instances: instanceService,
    launch,
    mods,
    modLibrary,
    maintenance,
    gameUpdates,
    updates,
    crash,
    modpack: modpackService,
    skin,
    versions,
    library,
    gameSettings,
    modrinth,
    getWindow: () => mainWindow,
    demo
  })

  if (!demo && process.argv.includes('--launch')) {
    mainWindow.webContents.on('did-finish-load', () => {
      setTimeout(() => {
        const id = store.get().activeInstanceId
        if (id && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('app:auto-launch', id)
        }
      }, 1750)
    })
  }

  if (smoke) {
    mainWindow.webContents.on('did-finish-load', () => {
      void captureSmoke(mainWindow!)
    })
  }

  if (captureSkinFlag) {
    mainWindow.webContents.on('did-finish-load', () => {
      void captureSkin(mainWindow!, store, captureOriginal)
    })
  }

  if (process.argv.includes('--feature-test')) {
    await runFeatureTest(store, skin, modrinth, instanceService, modpackService, crash)
    quitting = true
    app.quit()
    return
  }

  disposeServices = () => {
    modpackService.dispose()
  }
})

app.on('before-quit', () => {
  quitting = true
  try {
    disposeServices?.()
  } catch {
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || quitting) app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
})
