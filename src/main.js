import "./styles.css";
import "./themes.css";

import { updateGauge } from "./components/gauge.js";
import { version as packageVersion } from "../package.json";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { availableMonitors, currentMonitor, getCurrentWindow, LogicalSize, PhysicalPosition } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { check } from "@tauri-apps/plugin-updater";
import {
  CalendarDays,
  CircleDot,
  Clock3,
  createElement as createLucideElement,
  Crown,
  FolderOpen,
  Minus,
  Pin,
  PinOff,
  RefreshCw,
  Settings,
  X
} from "lucide";

const DEFAULT_SETTINGS = {
  codexCliPath: "",
  updateProxy: "",
  refreshIntervalMinutes: 5,
  locale: "zh",
  theme: "default",
  autoUpdateEnabled: true,
  autoStartEnabled: false,
  widgetMode: "panel",
  panelPosition: null,
  ballPosition: null,
  ballDock: null
};

const APP_VERSION_LABEL = packageVersion ? `v${String(packageVersion).trim()}` : "";
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const WIDGET_MODES = {
  PANEL: "panel",
  BALL: "ball"
};
const THEMES = {
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
  }
};
const PANEL_SIZE = { width: 390, height: 236 };
const BALL_SIZE = 88;
const SNAP_DISTANCE = 24;
const CLICK_DELAY_MS = 220;
const PANEL_DOUBLE_CLICK_MS = 320;
const PANEL_DOUBLE_CLICK_DISTANCE = 8;
const POSITION_SAVE_DEBOUNCE_MS = 300;
const ACTION_ICONS = {
  "calendar-days": CalendarDays,
  "circle-dot": CircleDot,
  "clock-3": Clock3,
  crown: Crown,
  "folder-open": FolderOpen,
  minus: Minus,
  pin: Pin,
  "pin-off": PinOff,
  "refresh-cw": RefreshCw,
  settings: Settings,
  x: X
};

const i18n = {
  zh: {
    brandName: "Codex CLI 额度",
    loading: "读取中",
    ready: "额度正常",
    low: "额度偏低",
    critical: "额度不足",
    empty: "额度耗尽",
    error: "读取失败",
    remaining: "剩余",
    primaryFallback: "5小时窗口",
    secondaryFallback: "7天窗口",
    plan: "套餐",
    unknown: "未知",
    noData: "暂无数据",
    reading: "正在通过 Codex CLI 读取额度...",
    refreshedAt: "已刷新",
    nextReset: "重置",
    primaryResetLabel: "5小时",
    secondaryResetLabel: "周重置",
    pin: "置顶",
    unpin: "取消置顶",
    refresh: "刷新",
    hide: "隐藏",
    exit: "退出",
    ballMode: "悬浮球",
    panelMode: "完整面板",
    unavailable: "未读取到额度数据",
    openCodex: "打开 Codex CLI",
    checkingUpdate: "正在检查更新...",
    updateAvailable: "发现新版本",
    updateDownloading: "正在下载更新",
    updateInstalling: "正在安装更新",
    updateReady: "更新已安装，重启后生效",
    updateFailed: "更新检查失败",
    settings: "设置",
    close: "关闭",
    codexPath: "Codex CLI 路径",
    chooseCodex: "选择 Codex CLI (codex.exe)",
    updateProxy: "更新代理",
    refreshInterval: "刷新分钟",
    theme: "主题",
    language: "语言",
    autoUpdate: "自动更新",
    autoUpdateHint: "更新依赖 GitHub，网络不可达时可能需要配置代理。",
    autoStart: "开机自启",
    autoStartHint: "登录系统后自动启动本应用，仅对当前用户生效。",
    updateProxyHint: "仅用于 GitHub 自动更新，不影响 Codex CLI。",
    save: "保存",
    cancel: "取消",
    settingsSaved: "设置已保存",
    codexPathPlaceholder: "留空自动探测",
    updateProxyPlaceholder: "http://127.0.0.1:7890"
  },
  en: {
    brandName: "Codex CLI Quota",
    loading: "Loading",
    ready: "Quota healthy",
    low: "Quota low",
    critical: "Quota insufficient",
    empty: "Quota empty",
    error: "Read failed",
    remaining: "Remain",
    primaryFallback: "5h window",
    secondaryFallback: "7d window",
    plan: "Plan",
    unknown: "Unknown",
    noData: "No data",
    reading: "Reading quota via Codex CLI...",
    refreshedAt: "Refreshed",
    nextReset: "Reset",
    primaryResetLabel: "5h reset",
    secondaryResetLabel: "Weekly reset",
    pin: "Pin",
    unpin: "Unpin",
    refresh: "Refresh",
    hide: "Hide",
    exit: "Exit",
    ballMode: "Floating ball",
    panelMode: "Full panel",
    unavailable: "No quota data",
    openCodex: "Open Codex CLI",
    checkingUpdate: "Checking for updates...",
    updateAvailable: "Update available",
    updateDownloading: "Downloading update",
    updateInstalling: "Installing update",
    updateReady: "Update installed. Restart to apply.",
    updateFailed: "Update check failed",
    settings: "Settings",
    close: "Close",
    codexPath: "Codex CLI path",
    chooseCodex: "Choose Codex CLI (codex.exe)",
    updateProxy: "Update proxy",
    refreshInterval: "Refresh min",
    theme: "Theme",
    language: "Language",
    autoUpdate: "Auto update",
    autoUpdateHint: "Updates depend on GitHub. Configure a proxy if the network cannot reach it.",
    autoStart: "Start at login",
    autoStartHint: "Launch this app automatically after signing in. Current user only.",
    updateProxyHint: "Only used for GitHub updates. It does not affect Codex CLI.",
    save: "Save",
    cancel: "Cancel",
    settingsSaved: "Settings saved",
    codexPathPlaceholder: "Empty for auto detect",
    updateProxyPlaceholder: "http://127.0.0.1:7890"
  }
};

const els = {
  body: document.body,
  trafficLight: document.getElementById("trafficLight"),
  brandName: document.getElementById("brandName"),
  stateText: document.getElementById("stateText"),
  modeBtn: document.getElementById("modeBtn"),
  settingsBtn: document.getElementById("settingsBtn"),
  pinBtn: document.getElementById("pinBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  minimizeBtn: document.getElementById("minimizeBtn"),
  closeBtn: document.getElementById("closeBtn"),
  liquidMeter: document.getElementById("liquidMeter"),
  gaugeLayer: document.getElementById("gaugeLayer"),
  liquidFill: document.getElementById("liquidFill"),
  remaining: document.getElementById("remaining"),
  remainingLabel: document.getElementById("remainingLabel"),
  primaryLabel: document.getElementById("primaryLabel"),
  primaryText: document.getElementById("primaryText"),
  secondaryLabel: document.getElementById("secondaryLabel"),
  secondaryText: document.getElementById("secondaryText"),
  planLabel: document.getElementById("planLabel"),
  planText: document.getElementById("planText"),
  statusDot: document.getElementById("statusDot"),
  statusIcon: document.getElementById("statusIcon"),
  statusText: document.getElementById("statusText"),
  widget: document.querySelector(".widget"),
  settingsPanel: document.getElementById("settingsPanel"),
  settingsTitle: document.getElementById("settingsTitle"),
  settingsCloseBtn: document.getElementById("settingsCloseBtn"),
  codexPathLabel: document.getElementById("codexPathLabel"),
  codexPathInput: document.getElementById("codexPathInput"),
  chooseCodexBtn: document.getElementById("chooseCodexBtn"),
  autoUpdateLabel: document.getElementById("autoUpdateLabel"),
  autoUpdateHint: document.getElementById("autoUpdateHint"),
  autoUpdateSwitch: document.getElementById("autoUpdateSwitch"),
  autoStartLabel: document.getElementById("autoStartLabel"),
  autoStartHint: document.getElementById("autoStartHint"),
  autoStartSwitch: document.getElementById("autoStartSwitch"),
  updateProxyLabel: document.getElementById("updateProxyLabel"),
  updateProxyInput: document.getElementById("updateProxyInput"),
  updateProxyHint: document.getElementById("updateProxyHint"),
  refreshIntervalLabel: document.getElementById("refreshIntervalLabel"),
  refreshIntervalInput: document.getElementById("refreshIntervalInput"),
  themeLabel: document.getElementById("themeLabel"),
  themeSelect: document.getElementById("themeSelect"),
  languageLabel: document.getElementById("languageLabel"),
  localeSelect: document.getElementById("localeSelect"),
  customSelectShells: Array.from(document.querySelectorAll(".custom-select-shell")),
  cancelSettingsBtn: document.getElementById("cancelSettingsBtn"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  saveSettingsText: document.getElementById("saveSettingsText")
};

const state = {
  settings: { ...DEFAULT_SETTINGS },
  settingsDraft: { ...DEFAULT_SETTINGS },
  locale: DEFAULT_SETTINGS.locale,
  quota: null,
  loading: false,
  error: "",
  alwaysOnTop: true,
  resetTimer: null,
  refreshTimer: null,
  updateStatus: null,
  updateChecking: false,
  updateTimer: null,
  settingsOpen: false,
  savingSettings: false,
  widgetMode: DEFAULT_SETTINGS.widgetMode,
  ballDock: null,
  panelClick: null,
  ballPress: null,
  ballDrag: null,
  ballClickTimer: null,
  positionSaveTimer: null,
  windowMoveUnlisten: null,
  isApplyingWindowMode: false
};

initializeActionIcons();
bindEvents();
initialize();

function bindEvents() {
  els.widget.addEventListener("pointerdown", startWindowDrag);
  els.widget.addEventListener("pointermove", moveBallDrag);
  els.widget.addEventListener("pointerup", finishBallDrag);
  els.widget.addEventListener("pointercancel", finishBallDrag);

  els.modeBtn.addEventListener("click", () => setWidgetMode(WIDGET_MODES.BALL));
  els.settingsBtn.addEventListener("click", openSettingsPanel);

  els.pinBtn.addEventListener("click", async () => {
    try {
      const nextValue = !state.alwaysOnTop;
      state.alwaysOnTop = await invoke("set_always_on_top", { value: nextValue });
      render();
    } catch (error) {
      showError(error);
    }
  });

  els.refreshBtn.addEventListener("click", () => refreshQuota());
  els.minimizeBtn.addEventListener("click", hideWindow);
  els.closeBtn.addEventListener("click", closeApp);
  els.settingsCloseBtn.addEventListener("click", closeSettingsPanel);
  els.cancelSettingsBtn.addEventListener("click", closeSettingsPanel);
  els.saveSettingsBtn.addEventListener("click", saveSettings);
  els.chooseCodexBtn.addEventListener("click", chooseCodexPath);
  els.autoUpdateSwitch.addEventListener("change", syncAutoUpdateDraft);
  els.autoStartSwitch.addEventListener("change", syncAutoStartDraft);
  els.themeSelect.addEventListener("change", () => selectSettingsTheme(els.themeSelect.value));
  els.localeSelect.addEventListener("change", () => selectSettingsLocale(els.localeSelect.value));

  els.customSelectShells.forEach((shell) => {
    const trigger = shell.querySelector(".custom-select-trigger");
    const menu = shell.querySelector(".custom-select-menu");
    trigger?.addEventListener("click", (event) => {
      event.preventDefault();
      toggleCustomSelect(shell);
    });
    menu?.addEventListener("click", (event) => {
      const option = event.target instanceof Element ? event.target.closest(".custom-select-option") : null;
      if (!option) return;
      selectCustomOption(shell, option.dataset.value || "");
    });
  });

  document.addEventListener("pointerdown", (event) => {
    if (event.target instanceof Element && event.target.closest(".custom-select-shell")) return;
    closeCustomSelects();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeCustomSelects();
  });
}

async function startWindowDrag(event) {
  const noDragTarget =
    event.target instanceof Element
      ? event.target.closest("button, a, input, textarea, select, [data-no-drag]")
      : null;

  if (event.button !== 0 || noDragTarget) {
    clearPanelClick();
    return;
  }

  if (state.widgetMode === WIDGET_MODES.BALL) {
    clearPanelClick();
    await startBallDrag(event);
    return;
  }

  if (isPanelDoubleClick(event)) {
    clearPanelClick();
    event.preventDefault();
    await setWidgetMode(WIDGET_MODES.BALL);
    return;
  }

  rememberPanelClick(event);
  event.preventDefault();

  if (!window.__TAURI_INTERNALS__) return;

  try {
    await getCurrentWindow().startDragging();
  } catch (error) {
    console.error("启动窗口拖动失败", error);
  }
}

function rememberPanelClick(event) {
  state.panelClick = {
    at: Date.now(),
    screenX: event.screenX,
    screenY: event.screenY
  };
}

function isPanelDoubleClick(event) {
  const previous = state.panelClick;
  if (!previous) return false;

  const elapsed = Date.now() - previous.at;
  const distance = Math.hypot(event.screenX - previous.screenX, event.screenY - previous.screenY);
  return elapsed <= PANEL_DOUBLE_CLICK_MS && distance <= PANEL_DOUBLE_CLICK_DISTANCE;
}

function clearPanelClick() {
  state.panelClick = null;
}

async function startBallDrag(event) {
  event.preventDefault();
  state.ballPress = {
    pointerId: event.pointerId,
    startScreenX: event.screenX,
    startScreenY: event.screenY,
    currentScreenX: event.screenX,
    currentScreenY: event.screenY,
    moved: false
  };

  if (!window.__TAURI_INTERNALS__) return;

  try {
    els.widget.setPointerCapture?.(event.pointerId);
    const appWindow = getCurrentWindow();
    const [position, scaleFactor] = await Promise.all([appWindow.outerPosition(), appWindow.scaleFactor()]);
    const press = state.ballPress;
    if (!press || press.pointerId !== event.pointerId) return;

    const startPointerX = press.startScreenX * scaleFactor;
    const startPointerY = press.startScreenY * scaleFactor;
    state.ballDrag = {
      pointerId: event.pointerId,
      startPointerX,
      startPointerY,
      startX: position.x,
      startY: position.y,
      scaleFactor,
      moved: press.moved,
      frame: null,
      nextX: Math.round(position.x + press.currentScreenX * scaleFactor - startPointerX),
      nextY: Math.round(position.y + press.currentScreenY * scaleFactor - startPointerY)
    };
    render();
  } catch (error) {
    console.error("启动悬浮球拖动失败", error);
    state.ballDrag = null;
  }
}

function moveBallDrag(event) {
  const press = state.ballPress;
  if (!press || event.pointerId !== press.pointerId) return;

  press.currentScreenX = event.screenX;
  press.currentScreenY = event.screenY;
  if (!press.moved && Math.hypot(event.screenX - press.startScreenX, event.screenY - press.startScreenY) > 4) {
    markBallPressMoved(press);
  }

  const drag = state.ballDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;

  const nextX = drag.startX + event.screenX * drag.scaleFactor - drag.startPointerX;
  const nextY = drag.startY + event.screenY * drag.scaleFactor - drag.startPointerY;
  drag.nextX = Math.round(nextX);
  drag.nextY = Math.round(nextY);

  if (press.moved) {
    drag.moved = true;
  } else if (!drag.moved && Math.hypot(drag.nextX - drag.startX, drag.nextY - drag.startY) > 4) {
    drag.moved = true;
    markBallPressMoved(press);
  }

  if (drag.frame !== null) return;
  drag.frame = window.requestAnimationFrame(() => {
    drag.frame = null;
    if (!state.ballDrag) return;
    getCurrentWindow()
      .setPosition(new PhysicalPosition(drag.nextX, drag.nextY))
      .catch((error) => console.error("移动悬浮球失败", error));
  });
}

async function finishBallDrag(event) {
  const press = state.ballPress;
  const drag = state.ballDrag;
  if (!press || event.pointerId !== press.pointerId) return;

  state.ballPress = null;
  state.ballDrag = null;
  try {
    els.widget.releasePointerCapture?.(event.pointerId);
  } catch {
    // 指针捕获可能已由系统释放，这里只需要保证拖动状态被清理。
  }

  if (event.type === "pointercancel") return;

  const moved = press.moved || Boolean(drag?.moved);
  if (!moved) {
    await handleBallPressClick();
    return;
  }

  await snapBallAfterDrag(drag ? { x: drag.nextX, y: drag.nextY } : null);
}

function markBallPressMoved(press) {
  press.moved = true;
  clearBallClickTimer();
  state.ballDock = null;
  render();
}

async function handleBallPressClick() {
  if (state.widgetMode !== WIDGET_MODES.BALL) return;

  if (state.ballClickTimer) {
    clearBallClickTimer();
    await restorePanelFromBall();
    return;
  }

  state.ballClickTimer = window.setTimeout(() => {
    state.ballClickTimer = null;
    if (state.widgetMode === WIDGET_MODES.BALL && state.ballDock) {
      expandBallFromDock();
    }
  }, CLICK_DELAY_MS);
}

async function restorePanelFromBall() {
  if (state.widgetMode !== WIDGET_MODES.BALL) return;
  clearBallClickTimer();
  await setWidgetMode(WIDGET_MODES.PANEL);
}

function clearBallClickTimer() {
  if (!state.ballClickTimer) return;
  window.clearTimeout(state.ballClickTimer);
  state.ballClickTimer = null;
}

async function registerWindowMoveSave() {
  if (!window.__TAURI_INTERNALS__ || state.windowMoveUnlisten) return;

  try {
    state.windowMoveUnlisten = await getCurrentWindow().onMoved(() => {
      if (state.isApplyingWindowMode || state.ballDrag) return;
      scheduleSaveCurrentWindowPosition();
    });
  } catch (error) {
    console.error("监听窗口移动失败", error);
  }
}

function scheduleSaveCurrentWindowPosition() {
  if (!window.__TAURI_INTERNALS__ || state.isApplyingWindowMode) return;
  if (state.positionSaveTimer) {
    window.clearTimeout(state.positionSaveTimer);
  }
  state.positionSaveTimer = window.setTimeout(() => {
    state.positionSaveTimer = null;
    saveCurrentWindowPosition();
  }, POSITION_SAVE_DEBOUNCE_MS);
}

function clearPositionSaveTimer() {
  if (!state.positionSaveTimer) return;
  window.clearTimeout(state.positionSaveTimer);
  state.positionSaveTimer = null;
}

async function saveCurrentWindowPosition({ silent = true } = {}) {
  clearPositionSaveTimer();
  if (!window.__TAURI_INTERNALS__ || state.isApplyingWindowMode) return;

  try {
    const position = await readCurrentWindowPosition();
    if (!position) return;
    await persistWindowPosition(position, state.widgetMode, state.ballDock, { silent });
  } catch (error) {
    if (silent) {
      console.error("保存窗口位置失败", error);
    } else {
      showError(error);
    }
  }
}

async function persistWindowPosition(position, mode, dock = null, { silent = true } = {}) {
  const nextSettings = { ...state.settings, widgetMode: state.widgetMode };
  if (mode === WIDGET_MODES.BALL) {
    nextSettings.ballPosition = position;
    nextSettings.ballDock = normalizeBallDock(dock);
  } else {
    nextSettings.panelPosition = position;
  }
  applyNormalizedSettings(nextSettings, { syncDraft: !state.settingsOpen });
  await saveCurrentSettings({ silent });
}

async function readCurrentWindowPosition() {
  clearPositionSaveTimer();
  if (!window.__TAURI_INTERNALS__ || state.isApplyingWindowMode) return null;

  try {
    return normalizeWindowPosition(await getCurrentWindow().outerPosition());
  } catch (error) {
    console.error("读取窗口位置失败", error);
    return null;
  }
}

function mergeWindowPosition(settings, position) {
  if (!position) return settings;

  const nextSettings = { ...settings, widgetMode: state.widgetMode };
  if (state.widgetMode === WIDGET_MODES.BALL) {
    nextSettings.ballPosition = position;
    nextSettings.ballDock = normalizeBallDock(state.ballDock);
  } else {
    nextSettings.panelPosition = position;
  }
  return nextSettings;
}

async function hideWindow() {
  await saveCurrentWindowPosition();
  await invoke("hide_window");
}

async function closeApp() {
  await saveCurrentWindowPosition();
  await invoke("close_app");
}

async function initialize() {
  render();
  await loadSettings();
  await applyWidgetModeWindow();
  await registerWindowMoveSave();

  try {
    state.alwaysOnTop = await invoke("get_always_on_top");
  } catch {
    state.alwaysOnTop = true;
  }

  await listen("quota:refresh-requested", () => refreshQuota());
  await listen("window:always-on-top-changed", (event) => {
    state.alwaysOnTop = Boolean(event.payload);
    render();
  });

  refreshQuota();
  scheduleAutoRefresh();
  scheduleUpdateChecks();
}

async function setWidgetMode(nextMode) {
  if (state.widgetMode === nextMode) return;

  clearPanelClick();
  await saveCurrentWindowPosition();
  clearBallClickTimer();
  state.ballPress = null;
  state.ballDrag = null;
  state.settingsOpen = false;
  applyNormalizedSettings({ ...state.settings, widgetMode: nextMode });
  render();

  await applyWidgetModeWindow();
  await saveCurrentSettings();
}

async function saveCurrentSettings({ silent = false } = {}) {
  if (!window.__TAURI_INTERNALS__) return;

  try {
    const saved = await invoke("save_settings", { settings: state.settings });
    applyNormalizedSettings(saved, { syncDraft: !state.settingsOpen });
    render();
  } catch (error) {
    if (silent) {
      console.error("保存设置失败", error);
    } else {
      showError(error);
    }
  }
}

async function applyWidgetModeWindow({ keepPosition = false } = {}) {
  if (!window.__TAURI_INTERNALS__) return;

  state.isApplyingWindowMode = true;
  try {
    const appWindow = getCurrentWindow();
    const targetPosition = keepPosition ? await appWindow.outerPosition() : savedPositionForCurrentMode();

    if (state.widgetMode === WIDGET_MODES.BALL) {
      await applyBallWindow(targetPosition);
    } else {
      await applyPanelWindow(targetPosition);
    }
  } catch (error) {
    console.error("切换窗口模式失败", error);
  } finally {
    window.setTimeout(() => {
      state.isApplyingWindowMode = false;
    }, 100);
  }
}

async function applyBallWindow(targetPosition = null) {
  const appWindow = getCurrentWindow();
  await appWindow.setSize(new LogicalSize(BALL_SIZE, BALL_SIZE));

  const size = await appWindow.outerSize();
  const area = await workAreaForTargetPosition(targetPosition, size);
  if (!area) return;

  if (targetPosition) {
    const nextPosition = clampBallPositionToWorkArea(targetPosition, size, area, state.settings.ballDock);
    state.ballDock = state.settings.ballDock;
    await appWindow.setPosition(new PhysicalPosition(nextPosition.x, nextPosition.y));
    render();
    return;
  }

  state.ballDock = null;
  applyNormalizedSettings({ ...state.settings, ballDock: null });
  const nextPosition = defaultTopRightPosition(size, area);
  await appWindow.setPosition(new PhysicalPosition(nextPosition.x, nextPosition.y));
  render();
}

async function applyPanelWindow(targetPosition = null) {
  const appWindow = getCurrentWindow();
  await appWindow.setSize(new LogicalSize(PANEL_SIZE.width, PANEL_SIZE.height));

  const size = await appWindow.outerSize();
  const area = await workAreaForTargetPosition(targetPosition, size);
  if (!area) return;

  const nextPosition = targetPosition
    ? clampPositionToWorkArea(targetPosition, size, area)
    : defaultTopRightPosition(size, area);
  await appWindow.setPosition(new PhysicalPosition(nextPosition.x, nextPosition.y));
}

function savedPositionForCurrentMode() {
  return state.widgetMode === WIDGET_MODES.BALL ? state.settings.ballPosition : state.settings.panelPosition;
}

async function workAreaForTargetPosition(position, size) {
  if (position) {
    const monitors = await availableMonitors();
    const matched = monitors.find((monitor) => positionBelongsToWorkArea(position, size, monitor.workArea));
    if (matched) return matched.workArea;
  }

  const monitor = await currentMonitor();
  return monitor?.workArea || null;
}

function positionBelongsToWorkArea(position, size, area) {
  if (!area) return false;
  const bounds = workAreaBounds(area);
  const centerX = position.x + size.width / 2;
  const centerY = position.y + size.height / 2;
  return centerX >= bounds.left && centerX <= bounds.right && centerY >= bounds.top && centerY <= bounds.bottom;
}

function defaultTopRightPosition(size, area) {
  const bounds = workAreaBounds(area);
  return {
    x: Math.round(bounds.right - size.width - SNAP_DISTANCE),
    y: Math.round(bounds.top + SNAP_DISTANCE)
  };
}

function clampBallPositionToWorkArea(position, size, area, dock = null) {
  const bounds = workAreaBounds(area);
  const y = clamp(position.y, bounds.top, Math.max(bounds.top, bounds.bottom - size.height));
  let x = clamp(position.x, bounds.left, Math.max(bounds.left, bounds.right - size.width));

  if (dock === "left") {
    x = bounds.left - Math.round(size.width / 2);
  } else if (dock === "right") {
    x = bounds.right - Math.round(size.width / 2);
  }

  return {
    x: Math.round(x),
    y: Math.round(y)
  };
}

function resolveBallDock(position, size, bounds) {
  const leftEdge = position.x;
  const rightEdge = position.x + size.width;
  const centerX = position.x + size.width / 2;
  const hitsLeftDock = leftEdge <= bounds.left + SNAP_DISTANCE;
  const hitsRightDock = rightEdge >= bounds.right - SNAP_DISTANCE;

  // 球体任一侧越过或进入吸附带，都代表用户想把悬浮球停靠到对应边缘。
  if (hitsLeftDock && hitsRightDock) {
    const boundsCenterX = bounds.left + (bounds.right - bounds.left) / 2;
    return centerX <= boundsCenterX ? "left" : "right";
  }
  if (hitsLeftDock) return "left";
  if (hitsRightDock) return "right";
  return null;
}

async function snapBallAfterDrag(targetPosition = null) {
  if (!window.__TAURI_INTERNALS__) return;

  try {
    const appWindow = getCurrentWindow();
    const [monitor, position, size] = await Promise.all([
      currentMonitor(),
      appWindow.outerPosition(),
      appWindow.outerSize()
    ]);
    const area = monitor?.workArea;
    if (!area) return;

    const bounds = workAreaBounds(area);
    const dragPosition = targetPosition || position;
    const dock = resolveBallDock(dragPosition, size, bounds);
    const y = clamp(dragPosition.y, bounds.top, Math.max(bounds.top, bounds.bottom - size.height));
    let x = clamp(dragPosition.x, bounds.left, Math.max(bounds.left, bounds.right - size.width));

    if (dock === "left") {
      x = bounds.left - Math.round(size.width / 2);
    } else if (dock === "right") {
      x = bounds.right - Math.round(size.width / 2);
    }

    const nextPosition = { x: Math.round(x), y: Math.round(y) };
    state.ballDock = dock;
    await appWindow.setPosition(new PhysicalPosition(nextPosition.x, nextPosition.y));
    await persistWindowPosition(nextPosition, WIDGET_MODES.BALL, dock);
    render();
  } catch (error) {
    console.error("悬浮球吸附失败", error);
  }
}

async function expandBallFromDock() {
  if (!window.__TAURI_INTERNALS__ || !state.ballDock) return;

  try {
    const appWindow = getCurrentWindow();
    const [monitor, position, size] = await Promise.all([
      currentMonitor(),
      appWindow.outerPosition(),
      appWindow.outerSize()
    ]);
    const area = monitor?.workArea;
    if (!area) return;

    const bounds = workAreaBounds(area);
    const x = state.ballDock === "left" ? bounds.left : bounds.right - size.width;
    const y = clamp(position.y, bounds.top, Math.max(bounds.top, bounds.bottom - size.height));
    const nextPosition = { x: Math.round(x), y: Math.round(y) };
    state.ballDock = null;
    await appWindow.setPosition(new PhysicalPosition(nextPosition.x, nextPosition.y));
    await persistWindowPosition(nextPosition, WIDGET_MODES.BALL, null);
    render();
  } catch (error) {
    console.error("展开悬浮球失败", error);
  }
}

function workAreaBounds(area) {
  return {
    left: area.position.x,
    top: area.position.y,
    right: area.position.x + area.size.width,
    bottom: area.position.y + area.size.height
  };
}

function clampPositionToWorkArea(position, size, area) {
  const bounds = workAreaBounds(area);
  return {
    x: Math.round(clamp(position.x, bounds.left, Math.max(bounds.left, bounds.right - size.width))),
    y: Math.round(clamp(position.y, bounds.top, Math.max(bounds.top, bounds.bottom - size.height)))
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

async function refreshQuota() {
  if (state.loading) return;

  state.loading = true;
  state.error = "";
  render();

  try {
    state.quota = await invoke("get_quota");
    state.error = "";
    scheduleResetRefresh(state.quota?.resetsAt);
  } catch (error) {
    state.quota = null;
    scheduleResetRefresh(null);
    state.error = normalizeError(error);
  } finally {
    state.loading = false;
    render();
  }
}

function scheduleResetRefresh(resetsAt) {
  if (state.resetTimer) {
    window.clearTimeout(state.resetTimer);
    state.resetTimer = null;
  }

  if (!resetsAt) return;
  const delay = new Date(resetsAt).getTime() - Date.now() + 1500;
  if (!Number.isFinite(delay) || delay <= 0) return;

  state.resetTimer = window.setTimeout(refreshQuota, Math.min(delay, refreshIntervalMs()));
}

function scheduleAutoRefresh() {
  if (state.refreshTimer) {
    window.clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }
  state.refreshTimer = window.setInterval(refreshQuota, refreshIntervalMs());
}

function refreshIntervalMs() {
  const minutes = Number(state.settings.refreshIntervalMinutes) || DEFAULT_SETTINGS.refreshIntervalMinutes;
  return Math.max(1, Math.min(1440, minutes)) * 60 * 1000;
}

function render() {
  const activeLocale = renderLocale();
  const activeTheme = renderTheme();
  const text = i18n[activeLocale];
  const quota = state.quota;
  const hasQuota = Boolean(quota);
  const panelRemaining = typeof quota?.remainingPercent === "number" ? quota.remainingPercent : null;
  const ballRemaining = primaryRemainingPercent(quota);
  const remaining = state.widgetMode === WIDGET_MODES.BALL ? ballRemaining : panelRemaining;
  const remainingValue = remaining === null ? 0 : clamp(remaining, 0, 100);
  const visualState = getVisualState(remaining);
  const mainState = state.error && !hasQuota ? "error" : state.loading ? "loading" : visualState;
  const updateStatusText = formatUpdateStatus(text);

  document.documentElement.lang = activeLocale === "zh" ? "zh-CN" : "en";
  els.body.dataset.state = mainState;
  els.body.dataset.widgetMode = state.widgetMode;
  els.body.dataset.ballDock = state.ballDock || "none";
  els.body.dataset.theme = activeTheme;

  els.brandName.textContent = text.brandName;
  els.brandName.setAttribute("aria-label", APP_VERSION_LABEL ? `${text.brandName} ${APP_VERSION_LABEL}` : text.brandName);
  if (APP_VERSION_LABEL) {
    els.brandName.dataset.version = APP_VERSION_LABEL;
  } else {
    els.brandName.removeAttribute("data-version");
  }
  els.remainingLabel.textContent = text.remaining;
  els.remainingLabel.hidden = state.widgetMode === WIDGET_MODES.BALL;
  els.planLabel.textContent = text.plan;

  updateActionButton(els.modeBtn, "circle-dot", text.ballMode);
  updateActionButton(els.settingsBtn, "settings", text.settings);
  updateActionButton(els.pinBtn, state.alwaysOnTop ? "pin" : "pin-off", state.alwaysOnTop ? text.unpin : text.pin);
  updateActionButton(els.refreshBtn, "refresh-cw", text.refresh);
  updateActionButton(els.minimizeBtn, "minus", text.hide);
  updateActionButton(els.closeBtn, "x", text.exit);
  updateActionButton(els.settingsCloseBtn, "x", text.close);
  updateActionButton(els.chooseCodexBtn, "folder-open", text.chooseCodex);

  els.trafficLight.className = `traffic-light ${mainState}`;
  els.statusDot.className = `status-dot ${state.error ? "error" : mainState}`;

  if (state.error) {
    els.stateText.textContent = hasQuota ? stateLabel(visualState, text) : text.error;
    els.statusText.textContent = state.error;
  } else if (state.loading) {
    els.stateText.textContent = text.loading;
    els.statusText.textContent = text.reading;
  } else if (updateStatusText) {
    els.stateText.textContent = stateLabel(visualState, text);
    els.statusText.textContent = updateStatusText;
  } else {
    els.stateText.textContent = stateLabel(visualState, text);
    els.statusText.textContent = statusLabel(quota, text, activeLocale);
  }

  els.remaining.textContent = remaining === null ? "--%" : `${remaining}%`;
  els.liquidFill.style.height = `${waterFillPercent(remaining, activeTheme)}%`;
  els.liquidMeter.style.setProperty("--remaining-angle", `${remainingValue * 3.6}deg`);
  els.liquidMeter.dataset.level = visualState;
  updateGauge({
    root: els.gaugeLayer,
    percent: remaining,
    level: visualState,
    label: text.remaining,
    mode: state.widgetMode,
    dock: state.ballDock || "none"
  });

  renderWindow(quota?.primary, els.primaryLabel, els.primaryText, text.primaryFallback, text, activeLocale);
  renderWindow(quota?.secondary, els.secondaryLabel, els.secondaryText, text.secondaryFallback, text, activeLocale);
  els.planText.textContent = quota?.planType || text.unknown;
  renderSettingsPanel(text);
}

function renderLocale() {
  const locale = state.settingsOpen ? state.settingsDraft.locale : state.locale;
  return locale === "en" ? "en" : "zh";
}

function renderTheme() {
  const theme = state.settingsOpen ? state.settingsDraft.theme : state.settings.theme;
  return normalizeTheme(theme);
}

async function loadSettings() {
  if (!window.__TAURI_INTERNALS__) {
    applySettings(DEFAULT_SETTINGS);
    return;
  }

  try {
    const settings = await invoke("get_settings");
    applySettings(settings);
  } catch (error) {
    console.error("读取设置失败", error);
    applySettings(DEFAULT_SETTINGS);
  }
}

function applySettings(settings) {
  applyNormalizedSettings(settings);
  render();
}

function applyNormalizedSettings(settings, { syncDraft = true } = {}) {
  const normalized = normalizeSettings(settings);
  state.settings = normalized;
  state.locale = normalized.locale;
  state.widgetMode = normalized.widgetMode;
  state.ballDock = normalized.widgetMode === WIDGET_MODES.BALL ? normalized.ballDock : null;
  if (syncDraft) {
    syncSettingsDraftFromSettings();
  }
  return normalized;
}

function syncSettingsDraftFromSettings() {
  state.settingsDraft = { ...state.settings };
}

function normalizeSettings(settings) {
  const refreshIntervalMinutes = Number(settings?.refreshIntervalMinutes);
  const widgetMode = settings?.widgetMode === WIDGET_MODES.BALL ? WIDGET_MODES.BALL : WIDGET_MODES.PANEL;
  return {
    codexCliPath: typeof settings?.codexCliPath === "string" ? settings.codexCliPath : "",
    updateProxy: typeof settings?.updateProxy === "string" ? settings.updateProxy : "",
    refreshIntervalMinutes:
      Number.isInteger(refreshIntervalMinutes) && refreshIntervalMinutes >= 1 && refreshIntervalMinutes <= 1440
        ? refreshIntervalMinutes
        : DEFAULT_SETTINGS.refreshIntervalMinutes,
    locale: settings?.locale === "en" ? "en" : "zh",
    theme: normalizeTheme(settings?.theme),
    autoUpdateEnabled:
      typeof settings?.autoUpdateEnabled === "boolean" ? settings.autoUpdateEnabled : DEFAULT_SETTINGS.autoUpdateEnabled,
    autoStartEnabled:
      typeof settings?.autoStartEnabled === "boolean" ? settings.autoStartEnabled : DEFAULT_SETTINGS.autoStartEnabled,
    widgetMode,
    panelPosition: normalizeWindowPosition(settings?.panelPosition),
    ballPosition: normalizeWindowPosition(settings?.ballPosition),
    ballDock: normalizeBallDock(settings?.ballDock)
  };
}

function normalizeWindowPosition(position) {
  if (!position || typeof position !== "object") return null;
  const x = Number(position.x);
  const y = Number(position.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: Math.round(x),
    y: Math.round(y)
  };
}

function normalizeBallDock(dock) {
  return dock === "left" || dock === "right" ? dock : null;
}

function normalizeTheme(theme) {
  return Object.hasOwn(THEMES, theme) ? theme : DEFAULT_SETTINGS.theme;
}

function waterFillPercent(remaining, theme) {
  if (remaining === null) return 0;
  const value = clamp(remaining, 0, 100);
  if (theme === "basic1" && value > 0 && value < 20) return 18;
  return value;
}

function openSettingsPanel() {
  clearPanelClick();
  syncSettingsDraftFromSettings();
  state.settingsOpen = true;
  fillSettingsForm();
  render();
}

function closeSettingsPanel() {
  state.settingsOpen = false;
  syncSettingsDraftFromSettings();
  render();
}

function fillSettingsForm() {
  els.codexPathInput.value = state.settingsDraft.codexCliPath || "";
  els.updateProxyInput.value = state.settingsDraft.updateProxy || "";
  els.refreshIntervalInput.value = String(state.settingsDraft.refreshIntervalMinutes || DEFAULT_SETTINGS.refreshIntervalMinutes);
  els.autoUpdateSwitch.checked = Boolean(state.settingsDraft.autoUpdateEnabled);
  els.autoStartSwitch.checked = Boolean(state.settingsDraft.autoStartEnabled);
  renderThemeOptions(renderLocale());
  els.themeSelect.value = normalizeTheme(state.settingsDraft.theme);
  els.localeSelect.value = state.settingsDraft.locale === "en" ? "en" : "zh";
  syncCustomSelects();
}

function renderSettingsPanel(text) {
  els.settingsPanel.hidden = !state.settingsOpen;
  els.settingsTitle.textContent = text.settings;
  els.codexPathLabel.textContent = text.codexPath;
  els.autoUpdateLabel.textContent = text.autoUpdate;
  els.autoUpdateHint.textContent = text.autoUpdateHint;
  els.autoStartLabel.textContent = text.autoStart;
  els.autoStartHint.textContent = text.autoStartHint;
  els.updateProxyLabel.textContent = text.updateProxy;
  els.updateProxyHint.textContent = text.updateProxyHint;
  els.refreshIntervalLabel.textContent = text.refreshInterval;
  els.themeLabel.textContent = text.theme;
  els.languageLabel.textContent = text.language;
  els.codexPathInput.placeholder = text.codexPathPlaceholder;
  els.updateProxyInput.placeholder = text.updateProxyPlaceholder;
  els.cancelSettingsBtn.textContent = text.cancel;
  els.saveSettingsText.textContent = state.savingSettings ? text.loading : text.save;
  els.saveSettingsBtn.disabled = state.savingSettings;
  els.autoUpdateSwitch.checked = Boolean(state.settingsDraft.autoUpdateEnabled);
  els.autoStartSwitch.checked = Boolean(state.settingsDraft.autoStartEnabled);
  renderThemeOptions(renderLocale());
  els.themeSelect.value = normalizeTheme(state.settingsDraft.theme);
  els.localeSelect.value = state.settingsDraft.locale === "en" ? "en" : "zh";
  syncCustomSelects();
}

function syncCustomSelects() {
  els.customSelectShells.forEach(syncCustomSelect);
}

function syncCustomSelect(shell) {
  const select = shell.querySelector("select");
  const trigger = shell.querySelector(".custom-select-trigger");
  const valueNode = shell.querySelector(".custom-select-value");
  const menu = shell.querySelector(".custom-select-menu");
  if (!(select instanceof HTMLSelectElement) || !trigger || !valueNode || !menu) return;

  const selectedOption = select.selectedOptions[0] || select.options[0];
  valueNode.textContent = selectedOption?.textContent || "";
  trigger.disabled = select.disabled;
  trigger.setAttribute("aria-expanded", shell.classList.contains("open") ? "true" : "false");

  const options = Array.from(select.options).map((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "custom-select-option";
    button.dataset.value = option.value;
    button.dataset.selected = option.value === select.value ? "true" : "false";
    button.textContent = option.textContent;
    if (option.value === select.value) {
      button.setAttribute("aria-current", "true");
    }
    return button;
  });
  menu.replaceChildren(...options);
}

function toggleCustomSelect(shell) {
  const shouldOpen = !shell.classList.contains("open");
  closeCustomSelects(shell);
  shell.classList.toggle("open", shouldOpen);
  syncCustomSelect(shell);
}

function closeCustomSelects(exceptShell = null) {
  els.customSelectShells.forEach((shell) => {
    if (shell !== exceptShell) shell.classList.remove("open");
    syncCustomSelect(shell);
  });
}

function selectCustomOption(shell, value) {
  const select = shell.querySelector("select");
  if (!(select instanceof HTMLSelectElement)) return;

  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  closeCustomSelects();
}

function syncAutoUpdateDraft() {
  state.settingsDraft.autoUpdateEnabled = els.autoUpdateSwitch.checked;
  render();
}

function syncAutoStartDraft() {
  state.settingsDraft.autoStartEnabled = els.autoStartSwitch.checked;
  render();
}

function selectSettingsLocale(locale) {
  state.settingsDraft.locale = locale === "en" ? "en" : "zh";
  render();
}

function selectSettingsTheme(theme) {
  state.settingsDraft.theme = normalizeTheme(theme);
  render();
}

async function chooseCodexPath() {
  if (!window.__TAURI_INTERNALS__) return;

  try {
    const selected = await openDialog({
      multiple: false,
      directory: false,
      filters: [{ name: "Codex CLI", extensions: ["exe"] }]
    });
    if (typeof selected === "string") {
      els.codexPathInput.value = selected;
      state.settingsDraft.codexCliPath = selected;
    }
  } catch (error) {
    showError(error);
  }
}

async function saveSettings() {
  if (state.savingSettings) return;

  const draftSettings = collectSettingsDraft();
  const currentPosition = await readCurrentWindowPosition();
  const nextSettings = mergeWindowPosition(draftSettings, currentPosition);
  state.savingSettings = true;
  render();

  try {
    const saved = window.__TAURI_INTERNALS__
      ? await invoke("save_settings", { settings: nextSettings })
      : nextSettings;
    applySettings(saved);
    state.settingsOpen = false;
    state.error = "";
    setUpdateStatus({ type: "saved" });
    scheduleAutoRefresh();
    refreshQuota();
    scheduleUpdateChecks();
  } catch (error) {
    state.error = normalizeError(error);
  } finally {
    state.savingSettings = false;
    render();
  }
}

function collectSettingsDraft() {
  const refreshIntervalMinutes = Number.parseInt(els.refreshIntervalInput.value, 10);
  return {
    codexCliPath: normalizeInputValue(els.codexPathInput.value),
    updateProxy: normalizeInputValue(els.updateProxyInput.value),
    refreshIntervalMinutes: Number.isFinite(refreshIntervalMinutes) ? refreshIntervalMinutes : DEFAULT_SETTINGS.refreshIntervalMinutes,
    locale: els.localeSelect.value === "en" ? "en" : "zh",
    theme: normalizeTheme(els.themeSelect.value),
    autoUpdateEnabled: els.autoUpdateSwitch.checked,
    autoStartEnabled: els.autoStartSwitch.checked,
    widgetMode: state.widgetMode,
    panelPosition: state.settings.panelPosition,
    ballPosition: state.settings.ballPosition,
    ballDock: state.settings.ballDock
  };
}

function normalizeInputValue(value) {
  const text = value.trim();
  return text ? text : null;
}

function scheduleUpdateChecks() {
  if (state.updateTimer) window.clearInterval(state.updateTimer);
  state.updateTimer = null;
  if (!state.settings.autoUpdateEnabled) {
    clearUpdateStatus();
    return;
  }

  checkForUpdates();
  state.updateTimer = window.setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS);
}

async function checkForUpdates() {
  if (!window.__TAURI_INTERNALS__ || state.updateChecking || !state.settings.autoUpdateEnabled) return;

  state.updateChecking = true;
  setUpdateStatus({ type: "checking" });

  try {
    const update = await check(updateCheckOptions());
    if (!update) {
      clearUpdateStatus();
      return;
    }

    setUpdateStatus({ type: "available", version: update.version });
    await downloadAndInstallUpdate(update);
    setUpdateStatus({ type: "ready" });
  } catch (error) {
    console.error("自动更新失败", error);
    setUpdateStatus({ type: "failed" });
  } finally {
    state.updateChecking = false;
    render();
  }
}

async function downloadAndInstallUpdate(update) {
  let downloadedBytes = 0;
  let totalBytes = 0;

  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      downloadedBytes = 0;
      totalBytes = event.data?.contentLength || 0;
      setUpdateStatus({ type: "downloading", percent: null });
      return;
    }

    if (event.event === "Progress") {
      downloadedBytes += event.data?.chunkLength || 0;
      const percent = totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : null;
      setUpdateStatus({ type: "downloading", percent });
      return;
    }

    if (event.event === "Finished") {
      setUpdateStatus({ type: "installing" });
    }
  });
}

function setUpdateStatus(nextStatus) {
  state.updateStatus = nextStatus;
  render();
}

function clearUpdateStatus() {
  state.updateStatus = null;
  render();
}

function formatUpdateStatus(text) {
  const status = state.updateStatus;
  if (!status) return "";
  if (status.type === "checking") return text.checkingUpdate;
  if (status.type === "available") {
    return status.version ? `${text.updateAvailable} ${status.version}` : text.updateAvailable;
  }
  if (status.type === "downloading") {
    return typeof status.percent === "number" ? `${text.updateDownloading} ${status.percent}%` : text.updateDownloading;
  }
  if (status.type === "installing") return text.updateInstalling;
  if (status.type === "ready") return text.updateReady;
  if (status.type === "failed") return text.updateFailed;
  if (status.type === "saved") return text.settingsSaved;
  return "";
}

function updateCheckOptions() {
  const proxy = state.settings.updateProxy?.trim();
  return proxy ? { proxy } : undefined;
}

function initializeActionIcons() {
  [
    [els.modeBtn, "circle-dot"],
    [els.settingsBtn, "settings"],
    [els.pinBtn, "pin"],
    [els.refreshBtn, "refresh-cw"],
    [els.minimizeBtn, "minus"],
    [els.closeBtn, "x"],
    [els.settingsCloseBtn, "x"],
    [els.chooseCodexBtn, "folder-open"],
    [els.statusIcon, "refresh-cw"],
    [document.querySelector('[data-quota-icon="primary"]'), "clock-3"],
    [document.querySelector('[data-quota-icon="secondary"]'), "calendar-days"],
    [document.querySelector('[data-quota-icon="plan"]'), "crown"]
  ].forEach(([button, iconName]) => {
    setActionButtonIcon(button, iconName);
  });
}

function updateActionButton(button, iconName, label) {
  button.title = label;
  button.setAttribute("aria-label", label);
  button.classList.toggle(
    "active",
    (button === els.pinBtn && state.alwaysOnTop) || (button === els.modeBtn && state.widgetMode === WIDGET_MODES.BALL)
  );

  // 图标 DOM 初始化后保持稳定，只在置顶状态切换时替换对应图标，避免每次刷新重建按钮。
  if (button.dataset.iconName === iconName) return;
  setActionButtonIcon(button, iconName);
}

function setActionButtonIcon(button, iconName) {
  if (!button) return;
  button.dataset.iconName = iconName;
  button.replaceChildren(createActionIcon(iconName));
}

function renderThemeOptions(locale) {
  const currentTheme = normalizeTheme(state.settingsDraft.theme);
  const options = Object.entries(THEMES).map(([value, theme]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = theme.label[locale] || theme.label.zh;
    return option;
  });
  els.themeSelect.replaceChildren(...options);
  els.themeSelect.value = currentTheme;
}

function createActionIcon(iconName) {
  const iconNode = ACTION_ICONS[iconName];
  if (!iconNode) {
    console.error("未知按钮图标", iconName);
    return document.createElement("span");
  }

  const [tag, attrs, children] = iconNode;
  return createLucideElement([
    tag,
    {
      ...attrs,
      "aria-hidden": "true",
      "data-lucide": iconName,
      class: `lucide lucide-${iconName}`
    },
    children
  ]);
}

function primaryRemainingPercent(quota) {
  return typeof quota?.primary?.remainingPercent === "number" ? quota.primary.remainingPercent : null;
}

function renderWindow(windowData, labelEl, valueEl, fallbackLabel, text, locale) {
  labelEl.textContent = formatWindowLabel(windowData?.windowDurationMins, fallbackLabel, text, locale);
  if (!windowData || typeof windowData.remainingPercent !== "number") {
    valueEl.textContent = "--";
    return;
  }
  valueEl.textContent = `${windowData.remainingPercent}%`;
}

function formatWindowLabel(minutes, fallbackLabel, text, locale) {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) return fallbackLabel;
  if (minutes % 10080 === 0) {
    const value = minutes / 10080;
    return locale === "zh" ? `${value}周窗口` : `${value}w window`;
  }
  if (minutes % 1440 === 0) {
    const value = minutes / 1440;
    return locale === "zh" ? `${value}天窗口` : `${value}d window`;
  }
  if (minutes % 60 === 0) {
    const value = minutes / 60;
    return locale === "zh" ? `${value}小时窗口` : `${value}h window`;
  }
  return locale === "zh" ? `${minutes}分钟窗口` : `${minutes}m window`;
}

function statusLabel(quota, text, locale) {
  if (!quota) return text.noData;
  const fetchedAt = formatTimeOrPlaceholder(quota.fetchedAt, locale);
  const primaryResetAt = formatTimeOrPlaceholder(quota.primary?.resetsAt, locale);
  const secondaryResetAt = formatTimeOrPlaceholder(quota.secondary?.resetsAt, locale);
  return `${text.refreshedAt} ${fetchedAt} · ${text.primaryResetLabel} ${primaryResetAt} · ${text.secondaryResetLabel} ${secondaryResetAt}`;
}

function getVisualState(remaining) {
  if (remaining === null) return "unknown";
  if (remaining === 0) return "empty";
  if (remaining <= 10) return "critical";
  if (remaining < 50) return "low";
  return "ready";
}

function stateLabel(visualState, text) {
  if (visualState === "empty") return text.empty;
  if (visualState === "critical") return text.critical;
  if (visualState === "low") return text.low;
  if (visualState === "ready") return text.ready;
  return text.unavailable;
}

function formatDate(value, locale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatTimeOrPlaceholder(value, locale) {
  return value ? formatDate(value, locale) || "--" : "--";
}

function showError(error) {
  state.error = normalizeError(error);
  render();
}

function normalizeError(error) {
  if (typeof error === "string") return error;
  if (error?.message) return error.message;
  return JSON.stringify(error);
}
