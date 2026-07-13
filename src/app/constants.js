import { version as packageVersion } from "../../package.json";

export const DEFAULT_SETTINGS = {
  codexCliPath: "",
  updateProxy: "",
  refreshIntervalMinutes: 5,
  locale: "zh",
  theme: "default",
  meterWindow: "secondary",
  logLevel: "off",
  autoUpdateEnabled: true,
  autoStartEnabled: false,
  onboardingSeen: false,
  widgetMode: "panel",
  panelPosition: null,
  ballPosition: null,
  ballDock: null
};

export const APP_VERSION_LABEL = packageVersion ? `v${String(packageVersion).trim()}` : "";
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const WIDGET_MODES = {
  PANEL: "panel",
  BALL: "ball"
};
export const THEMES = {
  default: {
    label: {
      zh: "默认主题",
      en: "Default"
    }
  },
  basic1: {
    label: {
      zh: "基础主题 1",
      en: "Basic theme 1"
    }
  },
  basic2: {
    label: {
      zh: "基础主题 2",
      en: "Basic theme 2"
    }
  },
  basic3: {
    label: {
      zh: "基础主题 3",
      en: "Basic theme 3"
    }
  }
};

export const METER_WINDOWS = {
  primary: {
    label: {
      zh: "5小时窗口",
      en: "5h window"
    }
  },
  secondary: {
    label: {
      zh: "周窗口",
      en: "Weekly window"
    }
  }
};

export const LOG_LEVELS = {
  off: {
    label: {
      zh: "关闭",
      en: "Off"
    }
  },
  error: {
    label: {
      zh: "错误",
      en: "Error"
    }
  },
  warn: {
    label: {
      zh: "警告",
      en: "Warn"
    }
  },
  info: {
    label: {
      zh: "信息",
      en: "Info"
    }
  },
  debug: {
    label: {
      zh: "调试",
      en: "Debug"
    }
  },
  trace: {
    label: {
      zh: "跟踪",
      en: "Trace"
    }
  }
};

export const PANEL_SIZE = { width: 390, height: 236 };
export const BALL_SIZE = 88;
export const SNAP_DISTANCE = 24;
export const CLICK_DELAY_MS = 220;
export const PANEL_DOUBLE_CLICK_MS = 320;
export const PANEL_DOUBLE_CLICK_DISTANCE = 8;
export const POSITION_SAVE_DEBOUNCE_MS = 300;
export const RESET_CREDIT_EXPIRY_DISPLAY_LIMIT = 5;

export const i18n = {
  zh: {
    brandName: "Codex 额度",
    loading: "读取中",
    ready: "额度正常",
    low: "额度偏低",
    critical: "额度不足",
    empty: "额度耗尽",
    error: "读取失败",
    remaining: "剩余",
    primaryFallback: "5小时窗口",
    secondaryFallback: "7天窗口",
    plan: "重置次数",
    resetCreditExpiryPrefix: "过期时间：",
    unknown: "未知",
    noData: "暂无数据",
    reading: "正在通过 Codex CLI 读取额度...",
    refreshedAt: "已刷新",
    nextReset: "重置",
    primaryResetInlineLabel: "重置时间：",
    secondaryResetLabel: "重置时间：",
    pin: "置顶",
    unpin: "取消置顶",
    refresh: "刷新数据",
    hide: "隐藏",
    exit: "退出",
    ballMode: "悬浮球",
    panelMode: "完整面板",
    ballRestoreHint: "双击返回面板",
    unavailable: "未读取到额度数据",
    openCodex: "打开 Codex CLI",
    checkingUpdate: "正在检查更新...",
    updateAvailable: "发现新版本",
    updateDownloading: "正在下载更新",
    updateInstalling: "正在安装更新",
    updateReady: "更新已安装，重启后生效",
    updateFailed: "更新检查失败",
    updateCheckFailed: "获取版本失败",
    updateInstallFailed: "更新失败",
    updateLatest: "已是最新版本",
    checkUpdate: "检查更新",
    settings: "设置",
    close: "关闭",
    codexPath: "Codex CLI 路径",
    chooseCodex: "选择 Codex CLI (codex/codex.exe)",
    updateProxy: "更新代理",
    refreshInterval: "刷新分钟",
    theme: "主题",
    language: "语言",
    meterWindow: "仪表窗口",
    logLevel: "日志等级",
    autoUpdate: "自动更新",
    autoUpdateHint: "更新依赖 GitHub，网络不可达时可能需要配置代理。",
    autoStart: "开机自启",
    autoStartHint: "登录系统后自动启动本应用，仅对当前用户生效。",
    updateProxyHint: "用于 GitHub 自动更新和 ChatGPT 额度过期时间接口。",
    save: "保存",
    cancel: "取消",
    settingsSaved: "设置已保存",
    codexPathPlaceholder: "留空自动探测",
    updateProxyPlaceholder: "http://127.0.0.1:7890",
    onboardingMode: "切换悬浮球",
    onboardingModeTitle: "切换悬浮球",
    onboardingModeDescription: "在完整面板和悬浮球之间切换，按使用场景选择显示方式。",
    onboardingSettings: "打开设置，配置主题、语言等",
    onboardingSettingsTitle: "打开设置",
    onboardingSettingsDescription: "配置主题、语言等个性化选项，打造专属体验。",
    onboardingRefresh: "手动刷新额度",
    onboardingRefreshTitle: "手动刷新额度",
    onboardingRefreshDescription: "立即重新读取 Codex CLI 额度，获取最新状态。",
    onboardingUpdate: "点击版本号检查更新",
    onboardingUpdateTitle: "检查更新",
    onboardingUpdateDescription: "点击版本号检查新版本，保持组件及时更新。",
    onboardingClose: "关闭引导",
    onboardingPrev: "上一步",
    onboardingNext: "下一步",
    onboardingDone: "完成"
  },
  en: {
    brandName: "Codex Quota",
    loading: "Loading",
    ready: "Quota healthy",
    low: "Quota low",
    critical: "Quota insufficient",
    empty: "Quota empty",
    error: "Read failed",
    remaining: "Remain",
    primaryFallback: "5h window",
    secondaryFallback: "7d window",
    plan: "Reset credits",
    resetCreditExpiryPrefix: "Expiry: ",
    unknown: "Unknown",
    noData: "No data",
    reading: "Reading quota via Codex CLI...",
    refreshedAt: "Refreshed",
    nextReset: "Reset",
    primaryResetInlineLabel: "Reset:",
    secondaryResetLabel: "Reset:",
    pin: "Pin",
    unpin: "Unpin",
    refresh: "Refresh Data",
    hide: "Hide",
    exit: "Exit",
    ballMode: "Floating ball",
    panelMode: "Full panel",
    ballRestoreHint: "Double-click to restore panel",
    unavailable: "No quota data",
    openCodex: "Open Codex CLI",
    checkingUpdate: "Checking for updates...",
    updateAvailable: "Update available",
    updateDownloading: "Downloading update",
    updateInstalling: "Installing update",
    updateReady: "Update installed. Restart to apply.",
    updateFailed: "Update check failed",
    updateCheckFailed: "Version check failed",
    updateInstallFailed: "Update failed",
    updateLatest: "Already up to date",
    checkUpdate: "Check for updates",
    settings: "Settings",
    close: "Close",
    codexPath: "Codex CLI path",
    chooseCodex: "Choose Codex CLI (codex/codex.exe)",
    updateProxy: "Update proxy",
    refreshInterval: "Refresh min",
    theme: "Theme",
    language: "Language",
    meterWindow: "Meter window",
    logLevel: "Log level",
    autoUpdate: "Auto update",
    autoUpdateHint: "Updates depend on GitHub. Configure a proxy if the network cannot reach it.",
    autoStart: "Start at login",
    autoStartHint: "Launch this app automatically after signing in. Current user only.",
    updateProxyHint: "Used for GitHub updates and the ChatGPT quota expiry API.",
    save: "Save",
    cancel: "Cancel",
    settingsSaved: "Settings saved",
    codexPathPlaceholder: "Empty for auto detect",
    updateProxyPlaceholder: "http://127.0.0.1:7890",
    onboardingMode: "Switch to floating ball",
    onboardingModeTitle: "Switch to floating ball",
    onboardingModeDescription: "Switch between full panel and floating ball for different workflows.",
    onboardingSettings: "Open settings for theme, language, and more",
    onboardingSettingsTitle: "Open settings",
    onboardingSettingsDescription: "Configure theme, language, and other personal preferences.",
    onboardingRefresh: "Refresh quota manually",
    onboardingRefreshTitle: "Refresh quota manually",
    onboardingRefreshDescription: "Read Codex CLI quota again and get the latest status.",
    onboardingUpdate: "Click version to check updates",
    onboardingUpdateTitle: "Check for updates",
    onboardingUpdateDescription: "Click the version to check for new releases and stay current.",
    onboardingClose: "Close guide",
    onboardingPrev: "Previous",
    onboardingNext: "Next",
    onboardingDone: "Done"
  }
};
