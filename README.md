# Codex 额度小组件

[English](README.en.md)

Codex 额度小组件是一个桌面悬浮工具。它通过本机已登录的 Codex 读取额度信息，并用面板或悬浮球展示 5 小时额度、周额度、上周与本周额度估算、剩余重置次数、刷新时间和重置时间。

### 功能介绍

- 面板模式：三个数据栏可分别选择 5 小时窗口、周窗口、重置次数或额度估算，并允许重复。
- 套餐默认：Plus 为“5 小时窗口 / 周窗口 / 额度估算”，其他或未知套餐为“额度估算 / 周窗口 / 重置次数”。
- 仪表与悬浮球：可在设置中选择展示 5 小时额度或周额度，新配置默认周额度。
- 边缘吸附：悬浮球可贴靠屏幕左右边缘，减少遮挡。
- 状态颜色：正常为绿色，偏低为黄色，不足、耗尽或错误为红色，读取中为蓝色。
- 自动刷新：默认每 5 分钟刷新一次，也会根据额度重置时间补充刷新。
- 自动更新：默认开启，通过 GitHub Releases 下载并安装更新。
- 开机自启：默认关闭，可在设置中开启，仅对当前用户生效。
- 主题切换：设置中可选择主题。
- 中英文界面：设置中可切换中文和 English，默认中文。

### 主题展示

#### 默认主题

<table>
  <tr>
    <td rowspan="2" style="text-align: center;"><strong>面板</strong><br><img src="docs/assets/ui_panel_theme_default.png" alt="默认主题面板"></td>
    <td style="text-align: center;"><strong>悬浮球</strong><br><img src="docs/assets/ui_ball_theme_default.png" alt="默认主题悬浮球"></td>
  </tr>
  <tr>
    <td style="text-align: center;"><strong>吸附</strong><br><img src="docs/assets/ui_dock_theme_default.png" alt="默认主题悬浮球吸附"></td>
  </tr>
</table>

#### 基础主题 1

<table>
  <tr>
    <td rowspan="2" style="text-align: center;"><strong>面板</strong><br><img src="docs/assets/ui_panel_theme_basics1.png" alt="基础主题 1 面板"></td>
    <td style="text-align: center;"><strong>悬浮球</strong><br><img src="docs/assets/ui_ball_theme_basics1.png" alt="基础主题 1 悬浮球"></td>
  </tr>
  <tr>
    <td style="text-align: center;"><strong>吸附</strong><br><img src="docs/assets/ui_dock_theme_basics1.png" alt="基础主题 1 悬浮球吸附"></td>
  </tr>
</table>

#### 基础主题 2

<table>
  <tr>
    <td rowspan="2" style="text-align: center;"><strong>面板</strong><br><img src="docs/assets/ui_panel_theme_basics2.png" alt="基础主题 2 面板"></td>
    <td style="text-align: center;"><strong>悬浮球</strong><br><img src="docs/assets/ui_ball_theme_basics2.png" alt="基础主题 2 悬浮球"></td>
  </tr>
  <tr>
    <td style="text-align: center;"><strong>吸附</strong><br><img src="docs/assets/ui_dock_theme_basics2.png" alt="基础主题 2 悬浮球吸附"></td>
  </tr>
</table>

#### 基础主题 3

<table>
  <tr>
    <td rowspan="2" style="text-align: center;"><strong>面板</strong><br><img src="docs/assets/ui_panel_theme_basics3.png" alt="基础主题 3 面板"></td>
    <td style="text-align: center;"><strong>悬浮球</strong><br><img src="docs/assets/ui_ball_theme_basics3.png" alt="基础主题 3 悬浮球"></td>
  </tr>
  <tr>
    <td style="text-align: center;"><strong>吸附</strong><br><img src="docs/assets/ui_dock_theme_basics3.png" alt="基础主题 3 悬浮球吸附"></td>
  </tr>
</table>

### 使用教程

1. 安装并登录 Codex。
2. 启动本应用。
3. 首次启动后，应用会自动探测本机 `codex` 或 `codex.exe`。
4. 如果读取失败，打开设置，手动选择 `codex` 或 `codex.exe` 路径。
5. 查看主面板中的三个数据栏；需要时可在设置中调整每栏内容和仪表窗口。
6. 点击圆形按钮切换悬浮球模式；双击悬浮球可回到面板。

### 设置说明

- Codex 路径：留空时自动探测；填写后优先使用该路径。
- 自动更新：关闭后不会检查、下载或安装 GitHub Releases 更新 (可能需要配置本地代理)。
- 自动更新代理：用于 GitHub 自动更新和 ChatGPT 额度过期时间接口，不影响 Codex CLI 主额度读取。支持 `http://`、`https://`、`socks5://`。
- 开机自启：登录系统后自动启动本应用，仅当前用户生效。
- 刷新分钟：自动刷新间隔，范围为 `1-1440`。
- 主题：可选择默认主题、基础主题 1、基础主题 2、基础主题 3，保存后重启仍保留。
- 语言：可选择中文或 English。
- 仪表窗口：选择仪表和悬浮球展示 5 小时额度或周额度，默认周额度。
- 数据栏 1/2/3：每栏可选择 5 小时窗口、周窗口、重置次数或额度估算，允许重复。未自定义时按套餐采用默认布局；保存自定义后不再随套餐变化。
- 数据缺失：所选 5 小时窗口或其他数据不可用时显示 `--`，不会自动替换成另一项。

### 额度估算与计算公式

额度估算表示“100% 周额度对应的 Token API 等价值”，用于观察周额度的大致价值，不是 OpenAI 实际账单。界面将达到样本和跨度门槛的结果四舍五入为整数美元；门槛不足时显示 `--`。

#### 数据来源与周期

应用流式扫描 `CODEX_HOME/sessions` 最近 16 天的本地会话日志，只提取模型、Token 用量、周额度百分比和重置时间。累计 Token 指纹用于去重。周窗口按 `10080` 分钟识别；30 分钟内漂移的重置时间视为同一周期，当前周期允许与实时重置时间相差 2 小时，上周期取此前最近的有效周期。

`codex-auto-review` 按 GPT-5.4 价格估算，正常参与费用累计和回归。其他无法公开计价的模型不会猜价，并会切断当前样本段。新样本段从新的额度百分比和累计费用基线开始，避免未知模型影响后续拟合。

#### 内置价格表

价格表日期：`2026-08-25`。价格单位均为“美元 / 百万 Token”，列顺序为输入、缓存输入、输出。

| 模型 | 输入 | 缓存输入 | 输出 |
|---|---:|---:|---:|
| [GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol) | 4 | 0.4 | 20 |
| [GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra) | 2 | 0.2 | 12 |
| [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) | 0.2 | 0.02 | 1.2 |
| [GPT-5.5](https://developers.openai.com/api/docs/models/gpt-5.5) | 5 | 0.5 | 30 |
| [GPT-5.4](https://developers.openai.com/api/docs/models/gpt-5.4) | 2.5 | 0.25 | 15 |

GPT-5.6 缓存写入按输入价格的 `1.25×` 计算。GPT-5.4（包括 `codex-auto-review`）没有独立缓存写入费率，因此按普通输入价格计算；`0.25` 仅用于缓存命中读取。GPT-5.5 没有内置公开缓存写入价格；出现缓存写入 Token 时，该事件不计价。

#### 单次事件费用

变量定义：

- `I`：输入 Token。
- `C`：缓存输入 Token。
- `W`：缓存写入 Token。
- `O`：输出 Token。
- `P_in`、`P_cached`、`P_write`、`P_out`：对应模型的每百万 Token 价格。

```text
U = max(I - C - W, 0)

I <= 272000 时：m_in = 1，m_out = 1
I > 272000 时： m_in = 2，m_out = 1.5

Cost = [m_in × (U × P_in + C × P_cached + W × P_write)
        + m_out × O × P_out] / 1,000,000
```

缓存输入和缓存写入先从输入 Token 中扣除。推理 Token 已包含在输出统计关系中，不再单独叠加。估算不包含工具调用费用。

#### 周额度回归

每个干净样本段以起点归零。令 `X` 为段内累计可计价美元，`Y` 为相对起点的周额度已用百分点，使用经过原点的最小二乘回归。有效跨度为所有干净样本段实际覆盖百分点区间的并集长度；重叠区间只计算一次，未观察区间不会被填补。

```text
k = Σ(X × Y) / Σ(X²)
100% 周额度 API 等价值 = 100 / k
```

仅同时满足以下条件才展示金额：有效百分点样本至少 `3` 个、唯一覆盖跨度至少 `2%`、斜率为正且有限。模型组合、长上下文比例、缓存命中和样本分布变化都会使估算值发生变化。

### 隐私说明

本应用只调用本机已有的 Codex，并复用本机登录状态读取额度。本应用不会要求输入或保存 Token。额度估算只读取本地会话日志中的结构化计量字段，不读取会话正文，不上传会话日志或估算数据，也不持久化估算结果。

### 社区

- [LINUX DO](https://linux.do)

### 常见问题

**找不到 Codex CLI**

在设置中手动选择 `codex` 或 `codex.exe`。应用会优先使用设置中的路径，其次读取 `CODEX_CLI_PATH`，再尝试系统 `PATH` 和常见安装目录。macOS 还会自动探测 `~/.nvm/versions/node/*/bin/codex`，并为 Codex 子进程补充对应的 Node 路径，Finder 启动时无需加载 `.zshrc`。也可按 [Codex CLI 官方说明](https://developers.openai.com/codex/cli/)安装独立版。

**额度读取失败**

确认 Codex 已安装、可运行并已登录。可以在终端运行 `codex` 检查登录状态。

**自动更新慢或失败**

自动更新依赖 GitHub Releases。如果网络不可达，在设置中配置自动更新代理。

**开机自启未生效**

关闭后重新开启一次开机自启，并确认系统启动项或登录项没有禁用本应用。本功能不需要管理员权限。

### 本地开发

安装依赖：

```powershell
npm install
```

启动开发模式：

```powershell
npm run tauri:dev
```

构建前端：

```powershell
npm run build
```

检查 Rust：

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
```

运行 Rust 测试：

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
```

生成 Windows NSIS 安装包：

```powershell
npm run tauri:build:nsis
```

生成 macOS Apple Silicon 安装包和更新包：

```powershell
npm run tauri:build:mac:aarch64:updater
```

生成 macOS Intel 安装包和更新包：

```powershell
npm run tauri:build:mac:x64:updater
```

生成 GitHub Release 产物：

```powershell
npm run release:github
```

Release 产物命名：

```txt
codex-widget_{version}_windows_x64-setup.exe
codex-widget_{version}_windows_x64-setup.exe.sig
codex-widget_{version}_macos_aarch64.dmg
codex-widget_{version}_macos_aarch64.app.tar.gz
codex-widget_{version}_macos_aarch64.app.tar.gz.sig
codex-widget_{version}_macos_x64.dmg
codex-widget_{version}_macos_x64.app.tar.gz
codex-widget_{version}_macos_x64.app.tar.gz.sig
latest.json
```

### 项目结构

```txt
codex-widget/
├─ .github/workflows/   # GitHub Actions 发布流程
├─ docs/assets/         # README 图片资源
├─ src/                 # 前端界面与交互
├─ src-tauri/           # Rust 后端、Tauri 配置和图标资源
├─ scripts/             # 图标生成和发布产物整理脚本
├─ index.html           # Vite 页面入口
├─ package.json         # 前端依赖和 npm 脚本
└─ README.md
```
