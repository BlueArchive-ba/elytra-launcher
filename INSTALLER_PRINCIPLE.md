# ELYTRA 安装程序原理

本文说明 `ELYTRA-<版本>-x64.exe` 的工作方式：它是怎么打出来的、双击之后做了什么、文件被放到哪里、卸载时又发生了什么。

## 1. 构建链路概览

```text
TypeScript / React 源码
        │  electron-vite build
        ▼
out/main/index.js  +  out/preload  +  out/renderer
        │  electron-builder --dir
        ▼
release/win-unpacked/            ← 免安装版（目录形式）
        │  electron-builder --win nsis --prepackaged
        ▼
release/ELYTRA-<版本>-x64.exe    ← NSIS 安装程序
```

三个关键配置来自 `package.json` 的 `build` 字段：

```json
{
  "appId": "com.qdq.elytra",
  "productName": "ELYTRA",
  "asar": true,
  "directories": { "output": "release", "buildResources": "build" },
  "win": {
    "target": ["nsis"],
    "artifactName": "ELYTRA-${version}-${arch}.${ext}",
    "signExecutable": false
  },
  "nsis": {
    "oneClick": false,
    "perMachine": false,
    "allowElevation": true,
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": true,
    "createStartMenuShortcut": true,
    "runAfterFinish": true,
    "deleteAppDataOnUninstall": false,
    "installerLanguages": ["zh_CN", "en_US"],
    "language": "2052",
    "installerIcon": "build/icon.ico",
    "uninstallerIcon": "build/icon.ico"
  }
}
```

## 2. 第一步：生成免安装目录

`electron-builder --dir` 会：

1. 读取本机 `node_modules/electron` 中的 Electron 运行时（这里用 `--config.electronDist=node_modules/electron/dist`，避免联网下载）；
2. 把 `out/`、`package.json`、图标等按 `files` 白名单复制进去；
3. 把应用代码打成 `resources/app.asar`；
4. 复制 Electron 运行时文件（`ELYTRA.exe`、`*.dll`、`resources/` 等）。

产物 `release/win-unpacked/` 就是**可以直接双击运行**的绿色版，不经过安装。安装程序本质上只是把这个目录搬运到目标机器。

主体文件：

```text
win-unpacked/
├── ELYTRA.exe              ← 由 electron.exe 重命名而来，是启动入口
├── *.dll                   ← Electron 依赖（渲染、图形、音视频等）
├── locales/                ← 界面语言包
└── resources/
    ├── app.asar            ← 你的全部应用代码 + 前端资源（压缩归档）
    └── tray.png            ← 托盘图标
```

`app.asar` 是一个只读归档格式，Electron 启动时会把它当作虚拟目录挂载到 `app/` 路径。里面的内容就是 `out/main`、`out/preload`、`out/renderer`。

`ELYTRA.exe` 启动后：

1. Electron 读取 `resources/app.asar` 里的 `package.json`；
2. 按 `main` 字段加载 `out/main/index.js`（主进程）；
3. 主进程创建 BrowserWindow，加载 `out/renderer/index.html`；
4. 预加载脚本 `out/preload/index.js` 通过 `contextBridge` 暴露 `window.ember` API。

## 3. 第二步：生成 NSIS 安装程序

`electron-builder --win nsis --prepackaged release/win-unpacked` 会：

1. 读取已经准备好的 `win-unpacked` 目录；
2. 用 7-Zip 把目录内容压缩成安装包内嵌的数据；
3. 编译一个 **NSIS（Nullsoft Scriptable Install System）** 脚本；
4. 把 NSIS 脚本、压缩数据、图标一起链接成单个 `ELYTRA-<版本>-x64.exe`。

NSIS 是一个 Windows 上广泛使用的安装包制作框架。最终产物是一个自解压可执行文件：

- 可执行部分 = NSIS 解释器 + 编译好的安装脚本；
- 数据部分 = 压缩后的应用文件；
- 资源部分 = 安装器图标、卸载器图标、语言文件。

所以安装包体积（约 112 MB）小于解压后的应用大小：Electron 运行时被 LZMA/7z 压缩过，安装时才展开。

## 4. 双击安装包之后发生了什么

NSIS 按脚本顺序执行，对应一个标准 Windows 安装向导：

1. **欢迎页**：显示产品名与版本，读取 `installerLanguages` 决定中文或英文界面。
2. **许可协议页**：显示 `license` 文件内容（没有则跳过）。
3. **安装目录页**：因为 `oneClick: false` + `allowToChangeInstallationDirectory: true`，用户可以修改路径。默认路径：
   - `perMachine: false` → `%LOCALAPPDATA%\Programs\<productName>`
   - 即 `C:\Users\<用户>\AppData\Local\Programs\ELYTRA`
4. **开始菜单 / 桌面快捷方式页**：`createStartMenuShortcut`、`createDesktopShortcut` 控制是否创建。
5. **安装页**：把内嵌的 7z 数据解压到目标目录。这一步等于把 `win-unpacked` 复制过去。
6. **完成页**：`runAfterFinish: true` 时勾选「运行 ELYTRA」后，安装器启动 `ELYTRA.exe`。

安装过程中 NSIS 会写入注册表，让软件出现在「应用和功能」列表中：

```text
HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\<appId 或 GUID>
  DisplayName     = ELYTRA
  DisplayVersion  = 1.2.5
  Publisher       = ...
  InstallLocation = C:\Users\<用户>\AppData\Local\Programs\ELYTRA
  UninstallString = "<安装目录>\Uninstall ELYTRA.exe"
```

因为默认是当前用户安装（`perMachine: false`），所以普通用户就能装，不需要管理员权限。如果用户手动选择 `C:\Program Files\...`，NSIS 会通过 `allowElevation: true` 弹出 UAC 提权。

## 5. 快捷方式

安装器会创建：

- 桌面快捷方式 → `ELYTRA.exe`
- 开始菜单项 → `ELYTRA`

快捷方式里记录的是安装目录下 `ELYTRA.exe` 的绝对路径。如果之后手动移动了安装目录，快捷方式会失效，需要重新安装或手动修复。

启动器内部的「创建自动启动快捷方式」是另一套逻辑：用 Electron 的 `shell.writeShortcutLink` 写一个带参数的 `.lnk`：

```text
目标：<安装目录>\ELYTRA.exe
参数：--instance <实例ID> --launch
```

双击后先启动启动器，等界面加载完成，再自动启动该实例。

## 6. 静默安装

NSIS 支持命令行参数：

```bat
ELYTRA-1.2.5-x64.exe /S
ELYTRA-1.2.5-x64.exe /S /D=C:\Apps\ELYTRA
```

- `/S`：静默安装，不显示向导。
- `/D=路径`：指定安装目录，必须是最后一个参数，路径不加引号，不支持中文与空格以外的特殊字符处理。

静默安装同样会写入卸载注册表项，但不弹完成页。

## 7. 卸载程序

安装时 NSIS 会顺带生成一个卸载器：

```text
<安装目录>\Uninstall ELYTRA.exe
```

它由安装包内的 `ELYTRA-<版本>-x64.__uninstaller.exe` 派生而来（构建日志里能看到），行为是：

1. 询问是否卸载（可在设置里静默调用）；
2. 结束正在运行的 `ELYTRA.exe`；
3. 删除安装目录下的程序文件；
4. 删除开始菜单项与桌面快捷方式；
5. 删除上面的卸载注册表项。

ELYTRA 设置页的「卸载 ELYTRA」按钮调用的就是主进程 `maintenance:uninstall`：

```ts
const uninstaller = ['Uninstall ELYTRA.exe', 'uninstall.exe']
  .map((name) => path.join(path.dirname(process.execPath), name))
  .find((file) => fs.existsSync(file))
spawn(uninstaller, [], { detached: true, stdio: 'ignore' })
setTimeout(() => app.quit(), 350)
```

即：找到同目录的卸载器 → 脱离启动器独立运行 → 启动器退出。由于卸载器需要删除启动器自身的文件，必须先把启动器关掉。

## 8. 用户数据不会随卸载删除

`deleteAppDataOnUninstall: false`，而且实例与存档本来就不在安装目录：

```text
%APPDATA%\ELYTRA        ← 配置、账户、崩溃分析历史、模组库
%APPDATA%\.ember        ← EML 管理的实例目录、mods、saves、logs
```

卸载只删除 `%LOCALAPPDATA%\Programs\ELYTRA` 里的程序文件。这样重装后实例和存档还在。需要彻底清理时手动删除上述两个目录。

启动器内的「清理不需要的文件」只删崩溃报告、日志、缓存和临时文件，不碰存档与模组。

## 9. 为什么会出现 SmartScreen 提示

`signExecutable: false`，安装包没有代码签名证书。Windows 不认识签名，SmartScreen 会提示「未知发布者」。

规避方式只有购买代码签名证书并在 `build.win` 里配置签名，代价是证书费用与签名时效。当前版本保持未签名。

## 10. 为什么安装包不依赖目标电脑的任何环境

- Electron 运行时已随包分发，目标电脑不需要 Node.js。
- 应用代码在 `app.asar` 中，不需要 `npm install`。
- Java 与 Minecraft 资源由启动器在第一次启动游戏时按需准备，不依赖系统预装。
- NSIS 安装器本身是自解压程序，不需要 .NET 或运行库。

所以在一台全新的 Windows 10/11 x64 上，双击安装包即可安装并启动 ELYTRA。

## 11. 构建与验证命令

```bash
npm run typecheck                 # 类型检查
npm run build                     # 生成 out/
node node_modules/electron-builder/out/cli/cli.js --dir \
  --config.electronDist=node_modules/electron/dist \
  --config.directories.output=release-v27          # 生成免安装目录

node node_modules/electron-builder/out/cli/cli.js --win nsis --x64 \
  --prepackaged release-v27/win-unpacked \
  --config.directories.output=release-v27          # 生成 NSIS 安装包
```

`--prepackaged` 表示「目录已经准备好，直接打包成安装程序」，避免重新走一遍 `--dir`，也方便在启动器本身被占用时先用临时目录构建。
