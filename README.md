# Codex 额度小组件 Rust 版

这是一个基于 Tauri 2 和 Rust 的 Windows 桌面悬浮小组件，用于读取本机 Codex 额度状态并用红、黄、绿三种状态展示剩余额度。

## 功能

- 红黄绿额度状态：剩余额度大于等于 10% 显示绿色，小于 10% 且大于 0 显示黄色，等于 0 显示红色。
- 液态玻璃悬浮窗口：无边框、透明背景、固定尺寸，启动后默认放在主屏幕右上角。
- 窗口控制：支持置顶、取消置顶、隐藏和退出。
- 系统托盘：支持显示/隐藏、刷新额度、置顶切换和退出。
- 自动刷新：默认每 5 分钟刷新一次；如果 Codex 返回重置时间，会在重置后再次刷新。
- 中英文界面切换：界面文案可在中文和英文之间切换。

## 隐私说明

应用只调用本机已有的 Codex CLI，并复用本机登录状态读取额度信息。应用不会要求输入 Token，不会保存 Token，也不会上传额度数据。

## 运行要求

- Windows 10 或 Windows 11。
- 已安装 Rust 工具链。
- 已安装 Node.js 20.19.0 或更高版本；项目使用 Vite 7，需要满足该版本要求。
- 已安装并登录 Codex。

## 本地运行

安装前端依赖：

```bash
npm install
```

如果本机通过 nvm 管理 Node.js，先切换到兼容版本：

```bash
nvm use 20.19.0
```

如果 Windows 权限导致 `nvm use` 失败，请在管理员终端执行，或将 `C:\Users\Administrator\AppData\Roaming\nvm\v20.19.0` 临时放到当前终端 `PATH` 最前面。

启动开发模式：

```bash
npm run tauri:dev
```

只构建前端：

```bash
npm run build
```

运行 Rust 测试：

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

运行 Rust 编译检查：

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

## Codex CLI 路径

应用会按以下顺序查找 Codex CLI：

1. `CODEX_CLI_PATH` 环境变量。
2. `%LOCALAPPDATA%\OpenAI\Codex\bin\codex.exe`。
3. `%LOCALAPPDATA%\OpenAI\Codex\bin\*\codex.exe`，用于兼容 Codex Windows 版的哈希子目录结构。
4. 系统 `PATH` 中的 `codex.exe`。

如果系统默认的 `codex.exe` 无法从当前权限环境启动，可以设置 `CODEX_CLI_PATH` 指向可执行的 Codex CLI。

## 项目结构

```txt
codex-widget/
├─ src/                 # 前端界面与交互
├─ src-tauri/           # Rust 后端和 Tauri 配置
├─ index.html           # Vite 页面入口
├─ package.json         # 前端依赖和脚本
└─ README.md
```

## 当前边界

首版只交付源码可运行版本，不包含 EXE 打包、代码签名、开机自启动、自定义刷新间隔和多主题。
