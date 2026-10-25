import { app } from 'electron'
import AdmZip from 'adm-zip'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Account } from 'eml-lib'
import type { InstanceRecord, JavaInfo, Settings } from '../shared/types'
import { splitArgs } from '../shared/utils'
import { gameDataDirFor } from './paths'
import type { VersionService } from './versions'

interface Rule {
  action?: 'allow' | 'disallow'
  os?: { name?: string; arch?: string; version?: string }
  features?: Record<string, boolean>
}

interface VersionArgument {
  rules?: Rule[]
  value: string | (string | VersionArgument)[]
}

interface DownloadArtifact {
  path?: string
  url?: string
  sha1?: string
  size?: number
}

interface Library {
  name: string
  downloads?: {
    artifact?: DownloadArtifact
    classifiers?: Record<string, DownloadArtifact>
  }
  natives?: Record<string, string>
  extract?: { exclude?: string[] }
  rules?: Rule[]
}

interface VersionJson {
  id?: string
  inheritsFrom?: string
  mainClass?: string
  type?: string
  assets?: string
  assetIndex?: { id?: string }
  javaVersion?: { majorVersion?: number }
  arguments?: {
    game?: (string | VersionArgument)[]
    jvm?: (string | VersionArgument)[]
  }
  minecraftArguments?: string
  libraries?: Library[]
  logging?: { client?: { argument?: string; file?: { id?: string } } }
  clientVersion?: string
  jar?: string
}

export interface LocalLaunchPlan {
  javaPath: string
  javaInfo: JavaInfo
  args: string[]
  cwd: string
  gameDir: string
  versionId: string
  versionDir: string
  assetsDir: string
  librariesDir: string
  nativesDir: string
  extractedNatives: boolean
  classpathCount: number
  requiredJava: number
}

interface BuildContext {
  versionDir: string
  gameRoot: string
  versionId: string
  gameDir: string
  librariesDir: string
  assetsDir: string
  nativesDir: string
  assetIndexId: string
  classpath: string[]
  javaVersion: number
}

function platformName(): string {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'osx'
  return 'linux'
}

function osArch(): string {
  if (process.arch === 'ia32') return 'x86'
  if (process.arch === 'arm64') return 'arm64'
  return 'x86_64'
}

function matchesRule(rule: Rule, features: Record<string, boolean>): boolean {
  if (rule.os) {
    if (rule.os.name && rule.os.name !== platformName()) return false
    if (rule.os.arch) {
      const arch = osArch()
      const expected = rule.os.arch
      if (expected !== arch && !(expected === 'x86' && arch === 'x86')) return false
    }
    if (rule.os.version) {
      try {
        if (!new RegExp(rule.os.version).test(os.release())) return false
      } catch {
        return false
      }
    }
  }
  if (rule.features) {
    for (const [key, value] of Object.entries(rule.features)) {
      if ((features[key] ?? false) !== value) return false
    }
  }
  return true
}

function rulesAllow(rules: Rule[] | undefined, features: Record<string, boolean>): boolean {
  if (!rules?.length) return true
  let allowed = false
  for (const rule of rules) {
    if (!matchesRule(rule, features)) continue
    allowed = rule.action !== 'disallow'
  }
  return allowed
}

function flattenArguments(
  entries: (string | VersionArgument)[] | undefined,
  features: Record<string, boolean>
): string[] {
  if (!entries?.length) return []
  const out: string[] = []
  const add = (value: string | (string | VersionArgument)[] | undefined) => {
    if (typeof value === 'string') out.push(value)
    else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') out.push(item)
        else if (item && typeof item === 'object') {
          if (!item.rules || rulesAllow(item.rules, features)) add(item.value)
        }
      }
    }
  }
  for (const entry of entries) {
    if (typeof entry === 'string') out.push(entry)
    else if (entry && typeof entry === 'object') {
      if (!entry.rules || rulesAllow(entry.rules, features)) add(entry.value)
    }
  }
  return out
}

function replacePlaceholders(value: string, map: Record<string, string>): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, key: string) => map[key] ?? '')
}

function artifactPath(lib: Library): string | null {
  if (lib.downloads?.artifact?.path) return lib.downloads.artifact.path
  const parts = lib.name.split(':')
  if (parts.length < 3) return null
  const [group, artifact, version, classifier] = parts
  const file = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.jar`
  return `${group.replace(/\./g, '/')}/${artifact}/${version}/${file}`
}

function classifierOf(name: string): string | undefined {
  const parts = name.split(':')
  return parts.length >= 4 ? parts[3] : undefined
}

function isNativeClassifier(name: string): boolean {
  return (classifierOf(name) ?? '').startsWith('natives-')
}

function isForeignClassifier(name: string): boolean {
  const classifier = classifierOf(name)
  if (!classifier) return false
  if (/^(linux|macos|osx|freebsd|unix)/i.test(classifier)) return true
  if (/^windows-(arm64|x86)$/i.test(classifier)) return true
  return false
}

function nativeClassifierForThisMachine(): string {
  if (process.arch === 'arm64') return 'natives-windows-arm64'
  if (process.arch === 'ia32') return 'natives-windows-x86'
  return 'natives-windows'
}

function nativeExtensions(): string[] {
  if (process.platform === 'win32') return ['.dll']
  if (process.platform === 'darwin') return ['.dylib', '.jnilib']
  return ['.so']
}

function hasNativeFiles(dir: string): boolean {
  try {
    const extensions = nativeExtensions()
    return fs.readdirSync(dir).some((file) => extensions.some((ext) => file.toLowerCase().endsWith(ext)))
  } catch {
    return false
  }
}

function deriveGameRoot(instance: InstanceRecord): string {
  if (instance.localGameRoot) return path.resolve(instance.localGameRoot)
  if (instance.customDir) return path.resolve(instance.customDir)
  if (instance.localVersionDir) return path.dirname(path.dirname(path.resolve(instance.localVersionDir)))
  return path.dirname(path.dirname(instance.localVersionDir ?? process.cwd()))
}

async function readFirstVersionJson(versionDir: string, versionId: string): Promise<VersionJson> {
  const preferred = path.join(versionDir, `${versionId}.json`)
  let file = preferred
  if (!fs.existsSync(file)) {
    const entries = await fsp.readdir(versionDir).catch(() => [])
    const found = entries.find((entry) => entry.toLowerCase().endsWith('.json'))
    if (!found) throw new Error(`版本目录缺少 JSON 清单：${versionDir}`)
    file = path.join(versionDir, found)
  }
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8')) as VersionJson
  } catch (err) {
    throw new Error(`无法读取版本清单 ${path.basename(file)}：${err instanceof Error ? err.message : String(err)}`)
  }
}

function mergeLibraries(base: Library[] | undefined, child: Library[] | undefined): Library[] {
  const map = new Map<string, Library>()
  for (const lib of base ?? []) map.set(lib.name, lib)
  for (const lib of child ?? []) map.set(lib.name, lib)
  return [...map.values()]
}

async function loadVersionChain(gameRoot: string, versionId: string, versionDir: string, seen = new Set<string>()): Promise<{ json: VersionJson; baseId?: string }> {
  if (seen.has(versionId)) throw new Error('版本继承出现循环')
  seen.add(versionId)
  const json = await readFirstVersionJson(versionDir, versionId)
  if (!json.inheritsFrom) return { json }
  const baseDir = path.join(gameRoot, 'versions', json.inheritsFrom)
  if (!fs.existsSync(path.join(baseDir, `${json.inheritsFrom}.json`))) {
    throw new Error(`版本 ${versionId} 继承自 ${json.inheritsFrom}，但找不到基础版本`)
  }
  const base = await loadVersionChain(gameRoot, json.inheritsFrom, baseDir, seen)
  return {
    json: {
      ...base.json,
      ...json,
      mainClass: json.mainClass ?? base.json.mainClass,
      assets: json.assets ?? base.json.assets,
      assetIndex: json.assetIndex ?? base.json.assetIndex,
      javaVersion: json.javaVersion ?? base.json.javaVersion,
      logging: json.logging ?? base.json.logging,
      libraries: mergeLibraries(base.json.libraries, json.libraries),
      arguments: {
        game: [...(base.json.arguments?.game ?? []), ...(json.arguments?.game ?? [])],
        jvm: [...(base.json.arguments?.jvm ?? []), ...(json.arguments?.jvm ?? [])]
      },
      minecraftArguments: json.minecraftArguments ?? base.json.minecraftArguments
    },
    baseId: base.baseId ?? base.json.id ?? json.inheritsFrom
  }
}

function findClientJar(versionDir: string, versionId: string, json: VersionJson, gameRoot: string, baseId?: string): string {
  const candidates = [
    path.join(versionDir, `${versionId}.jar`),
    json.jar ? path.join(versionDir, `${json.jar}.jar`) : '',
    baseId ? path.join(gameRoot, 'versions', baseId, `${baseId}.jar`) : ''
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  throw new Error('这个版本缺少客户端 JAR，无法直接启动；请先在原启动器中补全文件')
}

function chooseJava(list: JavaInfo[], required: number): JavaInfo {
  const exact = list.find((java) => java.major === required)
  if (exact) return exact
  const newer = list
    .filter((java) => java.major > required)
    .sort((a, b) => a.major - b.major)
  if (newer.length && required >= 17) return newer[0]
  if (required < 17) {
    throw new Error(`这个版本需要 Java ${required}，但只检测到 ${list.map((j) => j.major).join('、')}。请在实例设置中手动指定 Java ${required}`)
  }
  return list.slice().sort((a, b) => b.major - a.major)[0]
}

function collectLibraries(ctx: BuildContext, json: VersionJson): string[] {
  const features: Record<string, boolean> = {
    is_demo_user: false,
    has_custom_resolution: true,
    has_quick_plays_support: false,
    is_quick_play_singleplayer: false,
    is_quick_play_multiplayer: false,
    is_quick_play_realms: false
  }
  const missing: string[] = []
  const seen = new Set<string>()
  for (const lib of json.libraries ?? []) {
    if (!rulesAllow(lib.rules, features)) continue
    const classifier = classifierOf(lib.name)
    if (classifier?.startsWith('natives-')) continue
    if (isForeignClassifier(lib.name)) continue
    const relative = artifactPath(lib)
    if (!relative) continue
    const absolute = path.join(ctx.librariesDir, relative)
    if (!fs.existsSync(absolute)) {
      missing.push(lib.name)
      continue
    }
    if (!seen.has(absolute)) {
      seen.add(absolute)
      ctx.classpath.push(absolute)
    }
  }
  if (missing.length) {
    throw new Error(`缺少 ${missing.length} 个运行库：${missing.slice(0, 3).join('、')}${missing.length > 3 ? ' 等' : ''}。请先在原启动器中启动一次，或切换 EMBER 模式补齐`)
  }
  return missing
}

function nativeJarPaths(ctx: BuildContext, json: VersionJson): string[] {
  const features: Record<string, boolean> = {
    is_demo_user: false,
    has_custom_resolution: true,
    has_quick_plays_support: false,
    is_quick_play_singleplayer: false,
    is_quick_play_multiplayer: false,
    is_quick_play_realms: false
  }
  const target = nativeClassifierForThisMachine()
  const result: string[] = []
  for (const lib of json.libraries ?? []) {
    const classifier = classifierOf(lib.name)
    if (classifier === target) {
      const relative = artifactPath(lib)
      if (relative) result.push(path.join(ctx.librariesDir, relative))
      continue
    }
    if (lib.natives && process.platform === 'win32') {
      const key = lib.natives.windows
      if (key) {
        const artifact = lib.downloads?.classifiers?.[key]
        if (artifact?.path) result.push(path.join(ctx.librariesDir, artifact.path))
      }
    }
  }
  return [...new Set(result)].filter((file) => fs.existsSync(file))
}

async function ensureNatives(ctx: BuildContext, json: VersionJson): Promise<boolean> {
  const alternatives = [
    path.join(ctx.versionDir, `${ctx.versionId}-natives`),
    path.join(ctx.versionDir, 'natives')
  ]
  for (const candidate of alternatives) {
    if (hasNativeFiles(candidate)) {
      ctx.nativesDir = candidate
      return false
    }
  }
  const target = path.join(ctx.versionDir, `${ctx.versionId}-natives`)
  await fsp.mkdir(target, { recursive: true })
  ctx.nativesDir = target
  let extracted = 0
  const extensions = nativeExtensions()
  for (const jarPath of nativeJarPaths(ctx, json)) {
    try {
      const zip = new AdmZip(jarPath)
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue
        const base = entry.entryName.split('/').pop() ?? ''
        if (!base || base.startsWith('.')) continue
        if (!extensions.some((ext) => base.toLowerCase().endsWith(ext))) continue
        if (entry.entryName.startsWith('META-INF/')) continue
        await fsp.writeFile(path.join(target, base), entry.getData())
        extracted++
      }
    } catch {
      /* try the next native jar */
    }
  }
  if (!extracted) {
    throw new Error('缺少 native 运行库，无法直接启动；请先在原启动器中启动一次，或切换 EMBER 模式补齐')
  }
  return true
}

function logConfigPath(assetsDir: string, json: VersionJson): string | undefined {
  const configured = json.logging?.client?.file?.id ?? 'client-1.12.xml'
  const direct = path.join(assetsDir, 'log_configs', configured)
  return fs.existsSync(direct) ? direct : undefined
}

export async function planLocalLaunch(
  instance: InstanceRecord,
  settings: Settings,
  account: Account,
  versions: VersionService
): Promise<LocalLaunchPlan> {
  if (!instance.localVersionDir) {
    throw new Error('这个实例没有本地版本目录，无法使用本地启动')
  }
  const versionDir = path.resolve(instance.localVersionDir)
  const versionId = instance.localVersionId ?? path.basename(versionDir)
  if (!fs.existsSync(versionDir)) throw new Error(`本地版本目录不存在：${versionDir}`)
  const gameRoot = deriveGameRoot(instance)
  const gameDir = path.resolve(
    instance.localIsolated === false ? (instance.localGameRoot ?? gameRoot) : gameDataDirFor(instance)
  )
  await fsp.mkdir(gameDir, { recursive: true })

  const { json, baseId } = await loadVersionChain(gameRoot, versionId, versionDir)
  const librariesDir = path.join(gameRoot, 'libraries')
  const assetsDir = path.join(gameRoot, 'assets')
  const assetIndexId = json.assetIndex?.id ?? json.assets ?? 'legacy'
  const assetIndexPath = path.join(assetsDir, 'indexes', `${assetIndexId}.json`)
  if (!fs.existsSync(assetIndexPath)) {
    throw new Error(`缺少资源索引 ${assetIndexId}.json，无法直接启动；请先在原启动器中补全文件`)
  }
  const clientJar = findClientJar(versionDir, versionId, json, gameRoot, baseId)
  const requiredJava = json.javaVersion?.majorVersion ?? 8

  let javaInfo: JavaInfo
  if (settings.javaMode === 'manual') {
    if (!settings.javaPath.trim()) throw new Error('Java 模式为手动，但还没有选择 Java 路径')
    const info = await versions.validateJava(settings.javaPath)
    if (!info) throw new Error(`无法运行指定的 Java：${settings.javaPath}`)
    javaInfo = info
  } else {
    const list = await versions.detectJava()
    if (!list.length) {
      throw new Error(`没有检测到 Java ${requiredJava}。请在实例设置中选择 Java 路径；本地启动不会自动下载 Java`)
    }
    javaInfo = chooseJava(list, requiredJava)
  }
  if (javaInfo.major < requiredJava) {
    throw new Error(`这个版本需要 Java ${requiredJava}，当前选择的是 Java ${javaInfo.major}。请在实例设置中改用更高版本`)
  }

  const ctx: BuildContext = {
    versionDir,
    gameRoot,
    versionId,
    gameDir,
    librariesDir,
    assetsDir,
    nativesDir: path.join(versionDir, `${versionId}-natives`),
    assetIndexId,
    classpath: [],
    javaVersion: javaInfo.major
  }
  collectLibraries(ctx, json)
  ctx.classpath.push(clientJar)
  const extractedNatives = await ensureNatives(ctx, json)

  const features: Record<string, boolean> = {
    is_demo_user: false,
    has_custom_resolution: true,
    has_quick_plays_support: false,
    is_quick_play_singleplayer: false,
    is_quick_play_multiplayer: false,
    is_quick_play_realms: false
  }
  const replacements: Record<string, string> = {
    auth_player_name: account.name,
    auth_uuid: account.uuid.replace(/-/g, ''),
    auth_access_token: account.accessToken,
    auth_session: `token:${account.accessToken}:${account.uuid.replace(/-/g, '')}`,
    auth_xuid: account.xbox?.xuid ?? '0',
    clientid: '',
    client_id: '',
    user_type: account.meta.type === 'msa' ? 'msa' : 'legacy',
    version_type: json.type ?? 'release',
    user_properties: account.userProperties ? JSON.stringify(account.userProperties) : '{}',
    profile_name: account.name,
    game_directory: gameDir,
    game_assets: assetsDir,
    assets_root: assetsDir,
    assets_index_name: assetIndexId,
    version_name: versionId,
    natives_directory: ctx.nativesDir,
    library_directory: librariesDir,
    classpath: ctx.classpath.join(path.delimiter),
    classpath_separator: path.delimiter,
    launcher_name: 'ELYTRA',
    launcher_version: app.getVersion(),
    resolution_width: String(settings.windowWidth),
    resolution_height: String(settings.windowHeight),
    quickPlayPath: path.join(gameDir, 'quickPlay', 'quickPlay.log'),
    quickPlaySingleplayer: '',
    quickPlayMultiplayer: '',
    quickPlayRealms: ''
  }

  const replaceAll = (values: string[]) =>
    values
      .map((value) => replacePlaceholders(value, replacements))
      .filter((value) => !value.includes('${'))

  const jvmArgs: string[] = []
  if (json.arguments?.jvm?.length) {
    jvmArgs.push(...replaceAll(flattenArguments(json.arguments.jvm, features)))
  } else {
    jvmArgs.push(`-Djava.library.path=${ctx.nativesDir}`, '-cp', ctx.classpath.join(path.delimiter))
  }
  if (!jvmArgs.some((arg) => arg.startsWith('-Xmx'))) {
    jvmArgs.unshift(`-Xmx${settings.memoryMax}M`, `-Xms${settings.memoryMin}M`)
  }
  jvmArgs.push('-Dminecraft.launcher.brand=EMBER', `-Dminecraft.launcher.version=${app.getVersion()}`)
  jvmArgs.push('-Dlog4j2.formatMsgNoLookups=true')
  const logConfig = logConfigPath(assetsDir, json)
  if (logConfig && !jvmArgs.some((arg) => arg.startsWith('-Dlog4j.configurationFile='))) {
    jvmArgs.push(`-Dlog4j.configurationFile=${logConfig}`)
  }
  jvmArgs.push(...splitArgs(settings.jvmArgs))

  const gameArgs: string[] = []
  if (json.arguments?.game?.length) {
    gameArgs.push(...replaceAll(flattenArguments(json.arguments.game, features)))
  } else {
    gameArgs.push(...replaceAll(splitArgs(json.minecraftArguments ?? '')))
  }
  const hasFlag = (flag: string) => gameArgs.includes(flag)
  const ensureFlag = (flag: string, ...values: string[]) => {
    if (!hasFlag(flag)) gameArgs.push(flag, ...values)
  }
  ensureFlag('--username', account.name)
  ensureFlag('--version', versionId)
  ensureFlag('--gameDir', gameDir)
  ensureFlag('--assetsDir', assetsDir)
  ensureFlag('--assetIndex', assetIndexId)
  ensureFlag('--uuid', account.uuid.replace(/-/g, ''))
  ensureFlag('--accessToken', account.accessToken)
  ensureFlag('--userType', replacements.user_type)
  ensureFlag('--versionType', replacements.version_type)
  ensureFlag('--clientId', '')
  ensureFlag('--xuid', replacements.auth_xuid)
  if (!hasFlag('--width')) gameArgs.push('--width', String(settings.windowWidth))
  if (!hasFlag('--height')) gameArgs.push('--height', String(settings.windowHeight))
  if (settings.fullscreen && !hasFlag('--fullscreen')) gameArgs.push('--fullscreen')
  gameArgs.push(...splitArgs(settings.gameArgs))
  if (!json.mainClass) throw new Error('版本清单没有 mainClass，无法启动')

  return {
    javaPath: javaInfo.path,
    javaInfo,
    args: [...jvmArgs, json.mainClass, ...gameArgs],
    cwd: gameDir,
    gameDir,
    versionId,
    versionDir,
    assetsDir,
    librariesDir,
    nativesDir: ctx.nativesDir,
    extractedNatives,
    classpathCount: ctx.classpath.length,
    requiredJava
  }
}
