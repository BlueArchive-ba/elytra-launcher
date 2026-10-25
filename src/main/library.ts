import { app } from 'electron'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type {
  ImportGameInput,
  InstanceView,
  LibraryScan,
  LoaderSpec,
  LocalVersion,
  LocalVersionRoot
} from '../shared/types'
import type { ConfigStore } from './store'
import type { InstanceService } from './instances'
import { defaultGameDir } from './paths'

type Source = LocalVersion['source']

const VERSION_RE = /^\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?$/

interface PclSetup {
  present: boolean
  isolated: boolean
  vanilla?: string
  forge?: string
  neoforge?: string
  fabric?: string
  quilt?: string
}

function cleanName(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function sourceRoots(): { path: string; name: string; source: Source }[] {
  const home = process.env.USERPROFILE || process.env.HOME || app.getPath('home')
  const official =
    process.platform === 'win32'
      ? path.join(app.getPath('appData'), '.minecraft')
      : process.platform === 'darwin'
        ? path.join(app.getPath('appData'), 'minecraft')
        : path.join(home, '.minecraft')
  return [
    { path: official, name: '官方启动器', source: 'official' },
    { path: path.dirname(defaultGameDir('placeholder')), name: 'EMBER 实例', source: 'ember' }
  ]
}

function inferLoader(id: string, inheritsFrom: string | undefined, mainClass: string | undefined): {
  loader: LoaderSpec
  mcVersion: string
  uncertain: boolean
} {
  const lower = id.toLowerCase()
  const main = (mainClass ?? '').toLowerCase()
  const base = inheritsFrom && VERSION_RE.test(inheritsFrom) ? inheritsFrom : ''

  const fabric = id.match(/^fabric-loader-(.+)-(\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?)$/i)
  if (fabric && VERSION_RE.test(fabric[2])) {
    return { loader: { type: 'fabric', version: fabric[1] }, mcVersion: fabric[2], uncertain: false }
  }
  const quilt = id.match(/^quilt-loader-(.+)-(\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?)$/i)
  if (quilt && VERSION_RE.test(quilt[2])) {
    return { loader: { type: 'quilt', version: quilt[1] }, mcVersion: quilt[2], uncertain: false }
  }
  const forgeTail = id.match(/^(.+)-forge-(.+)$/i)
  if (forgeTail && VERSION_RE.test(forgeTail[1])) {
    return { loader: { type: 'forge', version: forgeTail[2] }, mcVersion: forgeTail[1], uncertain: false }
  }
  const forgeHead = id.match(/^forge-(\d+\.\d+(?:\.\d+)?)-(.+)$/i)
  if (forgeHead && VERSION_RE.test(forgeHead[1])) {
    return { loader: { type: 'forge', version: forgeHead[2] }, mcVersion: forgeHead[1], uncertain: false }
  }
  const neoTail = id.match(/^(.+)-neoforge-(.+)$/i)
  if (neoTail && VERSION_RE.test(neoTail[1])) {
    return { loader: { type: 'neoforge', version: neoTail[2] }, mcVersion: neoTail[1], uncertain: false }
  }
  const neoHead = id.match(/^neoforge-(.+)$/i)
  if (neoHead && base) {
    return { loader: { type: 'neoforge', version: neoHead[1] }, mcVersion: base, uncertain: false }
  }

  // PCL / third-party launchers often name folders like "1.20.1-Forge_47.4.22".
  const altForge = id.match(/^(.+?)[-_]forge[_-](.+)$/i)
  if (altForge && VERSION_RE.test(altForge[1])) {
    return {
      loader: { type: 'forge', version: altForge[2].replace(/^_+/, '') },
      mcVersion: altForge[1],
      uncertain: false
    }
  }
  const altNeo = id.match(/^(.+?)[-_]neoforge[_-](.+)$/i)
  if (altNeo && VERSION_RE.test(altNeo[1])) {
    return {
      loader: { type: 'neoforge', version: altNeo[2].replace(/^_+/, '') },
      mcVersion: altNeo[1],
      uncertain: false
    }
  }
  const altFabric = id.match(/^(.+?)[-_]fabric[_-](.+)$/i)
  if (altFabric && VERSION_RE.test(altFabric[1])) {
    return {
      loader: { type: 'fabric', version: altFabric[2].replace(/^_+/, '') },
      mcVersion: altFabric[1],
      uncertain: false
    }
  }
  const altQuilt = id.match(/^(.+?)[-_]quilt[_-](.+)$/i)
  if (altQuilt && VERSION_RE.test(altQuilt[1])) {
    return {
      loader: { type: 'quilt', version: altQuilt[2].replace(/^_+/, '') },
      mcVersion: altQuilt[1],
      uncertain: false
    }
  }

  if (main.includes('fabricmc') || lower.includes('fabric')) {
    return { loader: { type: 'fabric', version: '' }, mcVersion: base || id, uncertain: true }
  }
  if (main.includes('quiltmc') || lower.includes('quilt')) {
    return { loader: { type: 'quilt', version: '' }, mcVersion: base || id, uncertain: true }
  }
  if (main.includes('bootstraplauncher') || main.includes('neoforged') || lower.includes('neo')) {
    return { loader: { type: 'neoforge', version: '' }, mcVersion: base || id, uncertain: true }
  }
  if (main.includes('modlauncher') || lower.includes('forge')) {
    return { loader: { type: 'forge', version: '' }, mcVersion: base || id, uncertain: true }
  }
  return { loader: { type: 'vanilla', version: base || id }, mcVersion: base || id, uncertain: false }
}

function readPclSetup(versionDir: string): PclSetup {
  const file = path.join(versionDir, 'PCL', 'Setup.ini')
  if (!fs.existsSync(file)) return { present: false, isolated: false }
  const map = new Map<string, string>()
  try {
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const idx = raw.indexOf(':')
      if (idx <= 0) continue
      map.set(raw.slice(0, idx).trim().toLowerCase(), raw.slice(idx + 1).trim())
    }
  } catch {
    return { present: false, isolated: false }
  }
  const value = (key: string): string | undefined => {
    const found = map.get(key.toLowerCase())
    return found && found.length ? found : undefined
  }
  return {
    present: true,
    isolated: (value('VersionArgumentIndieV2') ?? 'False').toLowerCase() === 'true',
    vanilla: value('VersionVanillaName'),
    forge: value('VersionForge'),
    neoforge: value('VersionNeoForge'),
    fabric: value('VersionFabric') ?? value('VersionFabricLoader'),
    quilt: value('VersionQuilt') ?? value('VersionQuiltLoader')
  }
}

function setupLoader(inferred: ReturnType<typeof inferLoader>, setup: PclSetup): ReturnType<typeof inferLoader> {
  if (!setup.present) return inferred
  const mcVersion = setup.vanilla && VERSION_RE.test(setup.vanilla) ? setup.vanilla : inferred.mcVersion
  if (setup.neoforge) return { loader: { type: 'neoforge', version: setup.neoforge }, mcVersion, uncertain: false }
  if (setup.forge) return { loader: { type: 'forge', version: setup.forge }, mcVersion, uncertain: false }
  if (setup.fabric) return { loader: { type: 'fabric', version: setup.fabric }, mcVersion, uncertain: false }
  if (setup.quilt) return { loader: { type: 'quilt', version: setup.quilt }, mcVersion, uncertain: false }
  return { loader: { type: 'vanilla', version: mcVersion }, mcVersion, uncertain: false }
}

function hasClientJar(versionDir: string, versionId: string, inheritsFrom: string | undefined, root: string): boolean {
  if (fs.existsSync(path.join(versionDir, `${versionId}.jar`))) return true
  try {
    if (fs.readdirSync(versionDir).some((file) => file.toLowerCase().endsWith('.jar'))) return true
  } catch {
  }
  if (inheritsFrom) {
    return fs.existsSync(path.join(root, 'versions', inheritsFrom, `${inheritsFrom}.jar`))
  }
  return false
}

async function scanRoot(root: { path: string; name: string; source: Source }): Promise<{ root: LocalVersionRoot; versions: LocalVersion[] } | null> {
  const versionsDir = path.join(root.path, 'versions')
  let entries: fs.Dirent[]
  try {
    entries = await fsp.readdir(versionsDir, { withFileTypes: true })
  } catch {
    return null
  }
  const versions: LocalVersion[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const versionDir = path.join(versionsDir, entry.name)
    let files: string[]
    try {
      files = await fsp.readdir(versionDir)
    } catch {
      continue
    }
    const preferred = `${entry.name}.json`
    const jsonName = files.includes(preferred) ? preferred : files.find((file) => file.toLowerCase().endsWith('.json'))
    if (!jsonName) continue
    const jsonPath = path.join(versionDir, jsonName)
    try {
      const json = JSON.parse(await fsp.readFile(jsonPath, 'utf8')) as {
        id?: string
        inheritsFrom?: string
        type?: string
        mainClass?: string
      }
      const id = entry.name
      const inferred = inferLoader(json.id || id, json.inheritsFrom, json.mainClass)
      const setup = readPclSetup(versionDir)
      const effective = setupLoader(inferred, setup)
      const isolated = setup.present ? setup.isolated : false
      const hasJar = hasClientJar(versionDir, id, json.inheritsFrom, root.path)
      const stat = await fsp.stat(jsonPath).catch(() => null)
      versions.push({
        rootPath: root.path,
        rootName: root.name,
        source: root.source,
        launcher: setup.present ? 'pcl' : root.source,
        versionDir,
        gameDir: isolated ? versionDir : root.path,
        isolated,
        id,
        mcVersion: effective.mcVersion,
        loader: effective.loader,
        loaderUncertain: effective.uncertain || (effective.loader.type !== 'vanilla' && !effective.loader.version),
        hasJar,
        inheritsFrom: json.inheritsFrom,
        modifiedAt: stat?.mtimeMs ?? Date.now()
      })
    } catch {
      /* not a readable version */
    }
  }
  if (!versions.length) return null
  return {
    root: { path: root.path, name: root.name, source: root.source, count: versions.length },
    versions
  }
}

export class LibraryService {
  constructor(
    private store: ConfigStore,
    private instances: InstanceService
  ) {}

  async scan(customRoot?: string): Promise<LibraryScan> {
    const roots = sourceRoots()
    if (customRoot && customRoot.trim()) {
      roots.push({ path: path.resolve(customRoot.trim()), name: path.basename(customRoot.trim()) || '自定义目录', source: 'custom' })
    }
    const seenRoots = new Set<string>()
    const result: LibraryScan = { roots: [], versions: [], scannedAt: Date.now() }

    const scanOne = async (root: { path: string; name: string; source: Source }) => {
      const real = await fsp.realpath(root.path).catch(() => path.resolve(root.path))
      const key = path.resolve(real).toLowerCase()
      if (seenRoots.has(key)) return
      seenRoots.add(key)
      const scanned = await scanRoot(root)
      if (scanned) {
        result.roots.push(scanned.root)
        result.versions.push(...scanned.versions)
      } else if (root.source === 'custom') {
        result.roots.push({ path: root.path, name: root.name, source: root.source, count: 0 })
      }
    }

    for (const root of roots) {
      if (root.source === 'ember') {
        // An EMBER root contains one game directory per instance.
        let children: string[] = []
        try {
          children = await fsp.readdir(root.path)
        } catch {
          /* not installed yet */
        }
        for (const child of children) {
          const childPath = path.join(root.path, child)
          const stat = await fsp.stat(childPath).catch(() => null)
          if (stat?.isDirectory()) {
            await scanOne({ path: childPath, name: `EMBER · ${child}`, source: 'ember' })
          }
        }
        // A custom root may itself be an EMBER instance directory.
        await scanOne(root)
      } else {
        await scanOne(root)
      }
    }

    result.versions.sort((a, b) => {
      if (a.source !== b.source) return a.source === 'official' ? -1 : a.source === 'ember' ? 1 : 0
      return b.modifiedAt - a.modifiedAt
    })
    return result
  }

  async import(input: ImportGameInput): Promise<InstanceView> {
    const requested = path.resolve(input.rootPath)
    const rootPath = await fsp.realpath(requested).catch(() => requested)
    const scan = await this.scan(rootPath)
    const version = scan.versions.find((item) => path.resolve(item.rootPath) === rootPath && item.id === input.versionId)
    if (!version) throw new Error('找不到这个本地版本，它可能已经被移动或删除')
    if (version.loaderUncertain) {
      throw new Error('无法确定这个版本的加载器，请使用「新建实例」手动选择版本与加载器')
    }
    if (!version.hasJar) {
      throw new Error('这个版本缺少客户端 JAR，无法直接启动。请先在原启动器中补全，或使用「新建实例」由 EMBER 安装')
    }
    const cfg = this.store.get()
    const duplicate = cfg.instances.find(
      (item) =>
        (item.localVersionId === version.id &&
          !!item.localGameRoot &&
          path.resolve(item.localGameRoot) === rootPath) ||
        (item.importedFrom &&
          path.resolve(item.importedFrom) === rootPath &&
          item.mcVersion === version.mcVersion &&
          item.loader.type === version.loader.type &&
          !item.localVersionId)
    )
    if (duplicate) throw new Error(`这个版本已经加载为实例「${duplicate.name}」`)

    const loader: LoaderSpec =
      version.loader.type === 'vanilla'
        ? { type: 'vanilla', version: version.mcVersion }
        : version.loader
    return await this.instances.create({
      name: input.name.trim() || version.id,
      description: `从${version.rootName}加载，${version.isolated ? '使用 PCL 版本隔离目录' : '使用共享游戏目录'}，直接启动不再下载`,
      emblem: cleanName(version.id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || 'MC',
      accent: 'ember',
      mcVersion: version.mcVersion,
      loader,
      importedFrom: rootPath,
      launchMode: 'auto',
      localVersionId: version.id,
      localVersionDir: version.versionDir,
      localGameRoot: rootPath,
      localIsolated: version.isolated,
      sourceLauncher: version.launcher
    })
  }

  /**
   * Older EMBER builds pointed imported instances at the whole `.minecraft`
   * folder through a junction. That made EML mode write into the PCL install.
   * Move those records to the direct-launch model without touching game files.
   */
  async migrateLegacyImports(): Promise<void> {
    const cfg = this.store.get()
    for (const instance of cfg.instances) {
      if (!instance.importedFrom || instance.localVersionId) continue
      const root = path.resolve(instance.importedFrom)
      const realRoot = await fsp.realpath(root).catch(() => root)
      const scanned = await this.scan(realRoot)
      const candidates = scanned.versions.filter((item) => path.resolve(item.rootPath) === path.resolve(realRoot))
      const found =
        candidates.find(
          (item) =>
            item.mcVersion === instance.mcVersion &&
            item.loader.type === instance.loader.type &&
            item.loader.version === instance.loader.version
        ) ??
        candidates.find(
          (item) => item.mcVersion === instance.mcVersion && item.loader.type === instance.loader.type
        )
      if (!found) {
        // The old import pointed EML at someone else's game root. Never keep
        // that link: use an EMBER-managed directory instead.
        if (instance.customDir && path.resolve(instance.customDir) === root) {
          this.store.updateInstance(instance.id, { customDir: undefined, launchMode: 'ember' })
        }
        continue
      }
      if (instance.customDir && path.resolve(instance.customDir) === root) {
        const link = defaultGameDir(instance.slug)
        try {
          const stat = await fsp.lstat(link)
          if (stat.isSymbolicLink() && path.resolve(await fsp.realpath(link)) === path.resolve(realRoot)) {
            await fsp.unlink(link)
          }
        } catch {
          /* no junction */
        }
      }
      if (!found.hasJar) {
        // Incomplete local install: let EML repair it in its own directory.
        this.store.updateInstance(instance.id, {
          customDir: undefined,
          launchMode: 'ember'
        })
        continue
      }
      this.store.updateInstance(instance.id, {
        customDir: undefined,
        launchMode: 'auto',
        mcVersion: found.mcVersion,
        loader: found.loader,
        localVersionId: found.id,
        localVersionDir: path.join(realRoot, 'versions', found.id),
        localGameRoot: realRoot,
        localIsolated: found.isolated,
        sourceLauncher: found.launcher
      })
    }
  }
}
