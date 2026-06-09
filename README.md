# Codex 额度小组件 Rust 版

这是一个基于 Tauri 2、Rust 和 Vite 的 Windows 桌面悬浮小组件，用于读取本机 Codex 额度状态，并以红、黄、绿三种状态展示剩余额度。

## 功能

- 额度状态：剩余额度大于等于 10% 显示绿色，大于 0 且小于 10% 显示黄色，等于 0 显示红色。
- 额度读取：通过本机 Codex CLI 启动 `codex app-server --listen stdio://`，调用 `account/rateLimits/read` 获取数据。
- 会话复用：后端优先复用长连接 Codex 会话，避免每次刷新都重新启动 Codex CLI。
- 错误处理：读取失败时不伪装为额度耗尽，前端保留最近一次成功额度并显示错误提示。
- 悬浮窗口：液态玻璃风格、无边框、透明背景、默认位于主屏幕右上角。
- 窗口交互：支持整面板拖动、置顶切换、隐藏和退出。
- 系统托盘：支持显示或隐藏窗口、刷新额度、切换置顶和退出应用。
- 设置面板：支持设置 `codex.exe` 路径、自动更新开关、自动更新代理、自动刷新时间和界面语言。
- 自动刷新：默认每 5 分钟刷新一次，可在设置中调整；如果 Codex 返回重置时间，会在重置后补充刷新。
- 自动更新：默认开启；启动后检查一次更新，之后每 6 小时检查一次；发现新版本后自动下载并安装，重启后生效。
- 界面语言：支持中文和英文界面切换，语言入口位于设置面板。

## 隐私说明

应用只调用本机已有的 Codex CLI，并复用本机登录状态读取额度信息。应用不会要求输入 Token，不会保存 Token，也不会上传额度数据。

## 设置项

设置会保存到应用配置目录的 `settings.json`，由 Rust 后端读写。前端不启用 fs、shell、opener 等高风险插件。

- `codex.exe` 路径：留空时自动探测；填写后优先使用该路径，保存时会校验文件存在且文件名为 `codex.exe`。
- 自动更新：默认开启；关闭后不会检查、下载或安装 GitHub Releases 更新。
- 自动更新代理：仅用于本组件的 GitHub 自动更新检查和下载，不影响 Codex CLI 额度读取。支持 `http://`、`https://`、`socks5://`。
- 自动刷新时间：单位为分钟，允许 `1-1440`。
- 语言：通过下拉框选择中文或 English。

## 运行要求

- Windows 10 或 Windows 11。
- Rust 稳定工具链。
- Node.js 20.19.0 或更高版本。
- 已安装并登录 Codex。

如果本机通过 nvm 管理 Node.js，建议先切换到兼容版本：

```powershell
nvm use 20.19.0
```

如果 `nvm use` 受权限影响失败，请在管理员 PowerShell 中执行，或将对应 Node 版本目录临时放到当前终端 `PATH` 最前面。

## 本地开发

安装前端依赖：

```powershell
npm install
```

启动 Tauri 开发模式：

```powershell
npm run tauri:dev
```

只构建前端：

```powershell
npm run build
```

运行 Rust 测试：

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
```

运行 Rust 编译检查：

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
```

## Codex CLI 路径

应用会按以下顺序查找 Codex CLI：

1. 设置面板中保存的 `codex.exe` 路径。
2. `CODEX_CLI_PATH` 环境变量。
3. `%LOCALAPPDATA%\OpenAI\Codex\bin\codex.exe`。
4. `%LOCALAPPDATA%\OpenAI\Codex\bin\*\codex.exe`，用于兼容 Codex Windows 版的哈希子目录结构。
5. 系统 `PATH` 中的 `codex.exe`。

如果自动探测到的 `codex.exe` 无法从当前权限环境启动，优先在设置面板中选择可执行的 Codex CLI。

## 本地打包

生成普通 NSIS 安装包：

```powershell
npm run tauri:build:nsis
```

安装包输出目录：

```txt
src-tauri/target/release/bundle/nsis/
```

原始安装包文件名类似：

```txt
CodexWidget_0.2.0_x64-setup.exe
```

当前安装包不做 Windows Authenticode 代码签名，不依赖代码签名证书，也不需要 `signtool.exe`。首次安装时 Windows SmartScreen 可能提示风险，这是未签名安装包的预期现象。

## 自动更新与发布

自动更新依赖 GitHub Releases。如果当前网络无法访问 GitHub，可以在设置面板中配置自动更新代理。Tauri updater 仍需要更新包签名密钥，不使用 Windows 代码签名证书。公钥写入 `src-tauri/tauri.conf.json`，私钥只保存在本机或 GitHub Actions Secrets，不提交到 Git。

首次生成 updater 密钥：

```powershell
npm run updater:keygen
```

生成后会得到：

```txt
certs/updater.key
certs/updater.key.pub
```

`certs/` 已被 `.gitignore` 忽略，不要提交私钥。

在 GitHub 仓库中设置 Repository Secrets。`TAURI_SIGNING_PRIVATE_KEY` 保存 `certs/updater.key` 的完整文件内容，不是文件路径：

```powershell
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo 359956085/codex-widget < certs/updater.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo 359956085/codex-widget --body ""
```

如果生成密钥时设置了密码，请把 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 改为真实密码；如果没有密码，可以不创建该 Secret。

正式发布前，必须同步提升以下 3 处版本号并提交：

```txt
package.json
src-tauri/Cargo.toml
src-tauri/tauri.conf.json
```

然后推送与版本一致的标签，GitHub Actions 会自动构建、生成 updater 签名、整理 `latest.json` 并上传 GitHub Release：

```powershell
git tag v0.2.0
git push origin v0.2.0
```

Release 产物固定为：

```txt
codex-widget_{version}_windows_x64-setup.exe
codex-widget_{version}_windows_x64-setup.exe.sig
latest.json
```

生产更新清单地址固定为：

```txt
https://github.com/359956085/codex-widget/releases/latest/download/latest.json
```

本地调试 GitHub Release 产物时，可以设置 updater 私钥环境变量后执行：

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY=(Resolve-Path "certs\updater.key").Path
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
npm run release:github
```

调试产物输出目录：

```txt
src-tauri/target/release/github-release/
```

正式发布以 GitHub Actions 为准，本机不需要上传 Release。

## 项目结构

```txt
codex-widget/
├─ .github/workflows/   # GitHub Actions 发布流程
├─ src/                 # 前端界面与交互
├─ src-tauri/           # Rust 后端、Tauri 配置和图标资源
├─ scripts/             # 图标生成和发布产物整理脚本
├─ index.html           # Vite 页面入口
├─ package.json         # 前端依赖和 npm 脚本
└─ README.md
```

## 当前边界

当前发布流程支持 Windows x64 NSIS 安装包和 GitHub Releases 自动更新；暂不包含 MSI、多平台构建、Windows 代码签名、增量更新、开机自启动和多主题。
