import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'
import { app } from 'electron'
import type { CrashAnalysis, CrashFinding, CrashSeverity, CrashSource, InstanceRecord, IntegrityCheck, StackSuspect } from '../shared/types'
import { formatBytes, uid } from '../shared/utils'
import { gameDataDirFor } from './paths'
import type { ModService } from './mods'

const MAX = 8 * 1024 * 1024
const SKIP = ['java.', 'javax.', 'jdk.', 'sun.', 'org.lwjgl', 'net.minecraft', 'com.mojang', 'net.minecraftforge', 'cpw.mods', 'net.neoforged', 'org.spongepowered', 'net.fabricmc.loader', 'net.fabricmc.mixin', 'org.quiltmc.loader', 'com.google.', 'io.netty', 'org.apache.', 'org.slf4j', 'org.objectweb.asm']

type Rule = { id: string; title: string; severity: CrashSeverity; re: RegExp; summary: string; advice: string[]; confidence: number; limit?: number }

const RULES: Rule[] = [
  { id: 'oom', title: '内存耗尽 / Java 堆溢出', severity: 'critical', re: /OutOfMemoryError|Java heap space|GC overhead limit/i, summary: '游戏在分配内存时崩溃，可能是最大内存过高或过低。', advice: ['把最大内存调整到物理内存的 50%-60%', '关闭占用内存的后台程序', '把渲染距离或材质包降低后再测试'], confidence: 0.98 },
  { id: 'java', title: 'Java 版本不匹配', severity: 'critical', re: /UnsupportedClassVersionError|class file version|requires Java/i, summary: '模组或加载器要求的 Java 版本高于当前运行时。', advice: ['切换到 Java 17 或 Java 21', '或把 Java 安装模式切回自动'], confidence: 0.97 },
  { id: 'duplicate', title: '重复 Mod / 重复 Mod ID', severity: 'critical', re: /DuplicateModsFoundException|Found duplicate mods|duplicated mod/i, summary: '同一个 Mod 被加载了两次。', advice: ['在 Mod 管理页删除重复 ID 的 JAR', '检查普通版和重制版是否同时安装'], confidence: 0.96 },
  { id: 'mixin', title: 'Mixin 注入失败', severity: 'critical', re: /Mixin apply failed|InvalidMixinException|MixinTransformerError|Mixin apply for mod|Failed to inject/i, summary: 'Mixin 修改目标类时抛出异常，常见于两个 Mod 修改同一段代码。', advice: ['禁用堆栈嫌疑犯中的第一个模组', '检查优化 / 光影类 Mod 与加载器是否兼容', '升级加载器到当前版本的最新稳定版'], confidence: 0.9, limit: 6 },
  { id: 'class', title: '找不到类（依赖或版本冲突）', severity: 'warning', re: /NoClassDefFoundError|ClassNotFoundException/i, summary: '运行期加载类失败，通常是前置缺失或版本不匹配。', advice: ['根据缺失类包名安装对应前置', '重新下载可疑 JAR', '检查加载器版本'], confidence: 0.82, limit: 5 },
  { id: 'binary', title: '二进制接口不兼容', severity: 'warning', re: /NoSuchMethodError|NoSuchFieldError|AbstractMethodError|IncompatibleClassChangeError/i, summary: '一个 Mod 调用了不存在的接口，通常是版本不匹配。', advice: ['把相关 Mod 与前置升级到同一版本', '检查是否混入不同游戏版本的 JAR'], confidence: 0.8, limit: 5 },
  { id: 'corrupt', title: 'Mod JAR 损坏', severity: 'critical', re: /ZipException|invalid LOC header|zip END header not found|Invalid or corrupt jarfile/i, summary: '加载器无法读取某个 Mod JAR。', advice: ['删除损坏 JAR 后重新下载', '检查磁盘与杀毒隔离记录'], confidence: 0.97 },
  { id: 'graphics', title: '图形驱动 / OpenGL 失败', severity: 'warning', re: /GLFW error|OpenGL.*(error|failed)|Pixel format not accelerated|Failed to create window/i, summary: '游戏无法创建图形上下文。', advice: ['更新显卡驱动', '临时禁用光影与渲染优化 Mod', '降低分辨率或关闭全屏'], confidence: 0.78, limit: 5 }
]

const rank = (s: CrashSeverity) => ({ critical: 0, warning: 1, info: 2, good: 3 })[s]
const trim = (line: string, max = 360) => (line.length > max ? `${line.slice(0, max)}...` : line)

function lines(text: string, re: RegExp, limit = 4): string[] {
  const out: string[] = []
  for (const match of text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))) {
    const line = match[0].trim()
    if (line && !out.includes(line)) out.push(trim(line, 420))
    if (out.length >= limit) break
  }
  return out
}

function dependencyFinding(text: string): CrashFinding | null {
  const ranges = new Map<string, string>()
  for (const match of text.matchAll(/depends\s+([A-Za-z0-9_.-]+)\s*@\s*\[([^\]]*)\]/gi)) {
    if (!ranges.has(match[1])) ranges.set(match[1], match[2])
  }
  if (!ranges.size && !/Mod resolution failed|Incompatible mods found|HARD_DEP/i.test(text)) return null
  const names = [...ranges.keys()]
  const detail = names.map((name) => `${name} ${ranges.get(name)}`).join('、')
  return {
    id: 'missing-dependency',
    title: names.length ? `缺少前置：${names.join('、')}` : 'Mod 依赖解析失败',
    severity: 'critical',
    summary: names.length ? `加载器在启动阶段解析依赖失败：${detail} 没有找到可用版本。` : '加载器无法完成 Mod 依赖解析，通常是前置缺失或版本冲突。',
    evidence: lines(text, /.*(Mod resolution|HARD_DEP|depends |Incompatible mods|Fix: add|requires .* which is not installed).*/i, 8),
    advice: names.length ? [`安装或启用前置：${names.join('、')}，版本满足 ${detail}`, '按当前 Minecraft 版本和加载器下载前置', '禁用最近新增的 Mod 排查'] : ['安装缺失前置或移除冲突 JAR', '检查 Mod 版本是否统一'],
    confidence: 0.96
  }
}

function parseSuspects(text: string, modIds: string[]): StackSuspect[] {
  const out: StackSuspect[] = []
  let index = 0
  for (const match of text.matchAll(/^\s*at\s+([\w.$<>]+)\(([^)]*)\)/gm)) {
    const ref = match[1]
    const source = match[2]
    const className = ref.split('.').slice(0, -1).join('.')
    if (!className || index++ > 250 || SKIP.some((prefix) => className.startsWith(prefix))) continue
    const jar = source.match(/([^/\\()]+\.jar)/i)?.[1]
    const mod = modIds.find((id) => id.length > 2 && className.toLowerCase().includes(id.toLowerCase())) ?? jar?.replace(/\.jar$/i, '')
    out.push({ frame: trim(match[0].trim()), className, method: ref.split('.').pop() ?? ref, source, mod, reason: /mixin/i.test(source) ? 'Mixin 注入栈帧' : '第三方栈帧', score: 100 - Math.min(index, 40) })
    if (out.length >= 8) break
  }
  return out.sort((a, b) => b.score - a.score)
}

async function readText(file: string): Promise<string> {
  if (file.toLowerCase().endsWith('.gz')) return zlib.gunzipSync(await fsp.readFile(file), { maxOutputLength: MAX }).toString('utf8')
  const stat = await fsp.stat(file)
  if (stat.size <= MAX) return fsp.readFile(file, 'utf8')
  const handle = await fsp.open(file, 'r')
  try {
    const buffer = Buffer.alloc(MAX)
    await handle.read(buffer, 0, MAX, 0)
    return buffer.toString('utf8')
  } finally {
    await handle.close()
  }
}

function label(file: string, kind: CrashAnalysis['sourceKind']): string {
  if (kind === 'crash-report') return `崩溃报告 · ${path.basename(file)}`
  if (kind === 'hs-err') return `JVM 致命错误 · ${path.basename(file)}`
  if (kind === 'debug-log') return 'debug.log · 完整调试日志'
  if (kind === 'latest-log') return 'latest.log · 最近一次游戏日志'
  if (kind === 'log-archive') return `历史日志 · ${path.basename(file)}`
  return `启动会话日志 · ${path.basename(file)}`
}

function demo(instance: InstanceRecord, exitCode?: number): CrashAnalysis {
  return {
    id: uid('crash'), instanceId: instance.id, instanceName: instance.name, createdAt: Date.now(),
    sourceFile: `${gameDataDirFor(instance)}/crash-reports/crash-demo.txt`, sourceLabel: '崩溃报告 · crash-demo.txt', sourceKind: 'crash-report', exitCode: exitCode ?? -1,
    headline: 'Mixin 注入失败', severity: 'critical', confidence: 0.94,
    findings: [{ id: 'mixin', title: 'Mixin 注入失败', severity: 'critical', summary: '两个渲染类 Mod 同时修改了同一段代码。', evidence: ['Mixin apply failed: betterclouds.mixins.json:CloudRendererMixin -> LevelRenderer', 'Caused by: InvalidInjectionException'], advice: ['暂时禁用 Better Clouds，重启验证', '升级到支持当前加载器的版本'], confidence: 0.94 }],
    suspects: [{ frame: 'at betterclouds.mixin.CloudRendererMixin.injectFog(CloudRendererMixin.java:87)', className: 'betterclouds.mixin.CloudRendererMixin', method: 'injectFog', source: 'betterclouds.jar', mod: 'betterclouds', reason: 'Mixin 注入栈帧', score: 120 }],
    checks: [{ id: 'mods', label: 'Mod 文件', status: 'pass', detail: '可读' }, { id: 'reports', label: '崩溃报告归档', status: 'pass', detail: '1 个报告' }],
    exceptions: ['java.lang.RuntimeException: Mixin transformation failed', 'InvalidInjectionException'], logTail: ['Loading mods', 'Mixin apply for mod betterclouds failed'], byteSize: 48213
  }
}

export class CrashService {
  constructor(private mods: ModService, private demo = false) {}
  private logDir(): string { return path.join(app.getPath('userData'), 'launch-logs') }

  async sources(instance: InstanceRecord): Promise<CrashSource[]> {
    if (this.demo) return [{ path: `${gameDataDirFor(instance)}/crash-reports/crash-demo.txt`, label: '崩溃报告 · crash-demo.txt', kind: 'crash-report', modifiedAt: Date.now() - 60000, size: 48213, primary: true }]
    const root = gameDataDirFor(instance)
    const out: CrashSource[] = []
    const add = async (file: string, kind: CrashAnalysis['sourceKind']) => {
      try { const stat = await fsp.stat(file); if (stat.isFile()) out.push({ path: file, label: label(file, kind), kind, modifiedAt: stat.mtimeMs, size: stat.size, primary: false }) } catch { /* absent */ }
    }
    try { for (const name of (await fsp.readdir(path.join(root, 'crash-reports'))).filter((x) => x.endsWith('.txt')).sort().reverse().slice(0, 12)) await add(path.join(root, 'crash-reports', name), 'crash-report') } catch { /* absent */ }
    await add(path.join(root, 'logs', 'latest.log'), 'latest-log')
    await add(path.join(root, 'logs', 'debug.log'), 'debug-log')
    try { for (const name of (await fsp.readdir(path.join(root, 'logs'))).filter((x) => x.toLowerCase().endsWith('.log.gz')).sort().reverse().slice(0, 12)) await add(path.join(root, 'logs', name), 'log-archive') } catch { /* absent */ }
    try { for (const name of (await fsp.readdir(root)).filter((x) => /^hs_err_pid.*\.log$/i.test(x)).slice(-5)) await add(path.join(root, name), 'hs-err') } catch { /* absent */ }
    try { for (const name of (await fsp.readdir(this.logDir())).filter((x) => x.startsWith(`${instance.id}-`)).sort().reverse().slice(0, 5)) await add(path.join(this.logDir(), name), 'launch-log') } catch { /* absent */ }
    out.sort((a, b) => b.modifiedAt - a.modifiedAt)
    const primary = out.find((x) => x.kind === 'crash-report') ?? out.find((x) => x.kind === 'latest-log') ?? out[0]
    if (primary) primary.primary = true
    return out
  }

  private async context(instance: InstanceRecord, selected?: string): Promise<string> {
    const dir = path.join(gameDataDirFor(instance), 'logs')
    const files: string[] = []
    try {
      const names = await fsp.readdir(dir)
      files.push(path.join(dir, 'latest.log'), ...names.filter((x) => x.toLowerCase().endsWith('.log.gz')).sort().reverse().slice(0, 12).map((x) => path.join(dir, x)))
    } catch { return '' }
    const found: string[] = []
    for (const file of files) {
      if (selected && path.resolve(file) === path.resolve(selected)) continue
      try {
        for (const line of (await readText(file)).split(/\r?\n/)) {
          if (/ERROR|Exception|Caused by|HARD_DEP|Mod resolution|Incompatible mods|requires .* which is not installed|depends .*@|Fix: add/i.test(line) && !found.includes(line.trim())) found.push(line.trim().slice(0, 500))
        }
      } catch { /* archive */ }
    }
    return found.slice(-300).join('\n')
  }

  private async external(file: string): Promise<CrashSource | undefined> {
    try { const stat = await fsp.stat(file); if (stat.isFile()) return { path: file, label: label(file, file.endsWith('.gz') ? 'log-archive' : 'launch-log'), kind: file.endsWith('.gz') ? 'log-archive' : 'launch-log', modifiedAt: stat.mtimeMs, size: stat.size, primary: true } } catch { /* absent */ }
    return undefined
  }

  async analyze(instance: InstanceRecord, sourcePath?: string, exitCode?: number): Promise<CrashAnalysis> {
    if (this.demo && !sourcePath) return demo(instance, exitCode)
    const sources = await this.sources(instance)
    let source = sourcePath ? sources.find((x) => path.resolve(x.path) === path.resolve(sourcePath)) ?? await this.external(sourcePath) : sources.find((x) => x.primary) ?? sources[0]
    if (!source) source = { path: '', label: '无日志', kind: 'latest-log', modifiedAt: Date.now(), size: 0, primary: true }
    const text = source.path ? await readText(source.path).catch((err) => `无法读取日志：${err instanceof Error ? err.message : err}`) : '（没有日志）'
    const context = await this.context(instance, source.path)
    const all = context ? `${text}\n\n===== logs/ 错误上下文 =====\n${context}` : text
    const scan = await this.mods.scan(instance).catch(() => null)
    const modIds = scan?.mods.filter((m) => m.enabled && !m.invalid).map((m) => m.id).filter(Boolean) ?? []
    const findings: CrashFinding[] = []
    const add = (f: CrashFinding) => { if (!findings.some((x) => x.id === f.id)) findings.push(f) }
    const dep = dependencyFinding(all)
    if (dep) add(dep)
    for (const rule of RULES) if (rule.re.test(all)) add({ id: rule.id, title: rule.title, severity: rule.severity, summary: rule.summary, evidence: lines(all, rule.re, rule.limit ?? 4), advice: rule.advice, confidence: rule.confidence })
    if (!findings.length) add({ id: 'unknown', title: '未匹配到明确的崩溃规则', severity: 'info', summary: '日志中没有已知的致命异常，可能被截断或手动关闭。', evidence: lines(all, /ERROR|Exception|Caused by/i, 4), advice: ['选择最新崩溃报告', '查看 logs 归档', '检查堆栈嫌疑犯'], confidence: 0.4 })
    const suspects = parseSuspects(all, modIds)
    if (suspects.length) add({ id: 'suspect', title: `堆栈嫌疑犯：${suspects[0].mod ?? suspects[0].className}`, severity: 'info', summary: '跳过原版与加载器后的第一个第三方栈帧。', evidence: suspects.slice(0, 4).map((s) => s.frame), advice: ['暂时禁用相关模组验证', '检查最近更新的优化类模组'], confidence: 0.7 })
    findings.sort((a, b) => rank(a.severity) - rank(b.severity))
    const checks: IntegrityCheck[] = [
      { id: 'version', label: '版本', status: 'pass', detail: `${instance.mcVersion} · ${instance.loader.type}` },
      { id: 'mods', label: 'Mod 文件', status: scan?.invalidCount ? 'warn' : 'pass', detail: scan ? `${scan.enabledCount} 启用 / ${scan.invalidCount} 损坏` : '未读取' },
      { id: 'reports', label: '崩溃报告', status: sources.some((x) => x.kind === 'crash-report') ? 'pass' : 'skip', detail: `${sources.filter((x) => x.kind === 'crash-report').length} 个` }
    ]
    return {
      id: uid('crash'), instanceId: instance.id, instanceName: instance.name, createdAt: Date.now(), sourceFile: source.path, sourceLabel: source.label, sourceKind: source.kind, exitCode,
      headline: findings[0]?.title ?? '没有发现致命异常', severity: findings.reduce<CrashSeverity>((w, f) => rank(f.severity) < rank(w) ? f.severity : w, 'good'), confidence: findings[0]?.confidence ?? 0.4,
      findings, suspects, checks, exceptions: lines(all, /.*(?:Exception|Error).*/i, 8), logTail: all.split(/\r?\n/).filter(Boolean).slice(-36).map((x) => trim(x, 400)), byteSize: Buffer.byteLength(all)
    }
  }
}
