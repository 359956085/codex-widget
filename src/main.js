import "./styles.css";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { check } from "@tauri-apps/plugin-updater";
import { createElement as createLucideElement, FolderOpen, Minus, Pin, PinOff, RefreshCw, Settings, X } from "lucide";

const DEFAULT_SETTINGS = {
  codexCliPath: "",
  updateProxy: "",
  refreshIntervalMinutes: 5,
  locale: "zh",
  autoUpdateEnabled: true
};
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const ACTION_ICONS = {
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
    brandName: "Codex 额度",
    loading: "读取中",
    ready: "额度正常",
    low: "额度偏低",
    empty: "额度耗尽",
    error: "读取失败",
    remaining: "剩余",
    primaryFallback: "5小时窗口",
    secondaryFallback: "7天窗口",
    plan: "套餐",
    unknown: "未知",
    noData: "暂无数据",
    reading: "正在读取 Codex 额度...",
    refreshedAt: "已刷新",
    nextReset: "重置",
    pin: "置顶",
    unpin: "取消置顶",
    refresh: "刷新",
    hide: "隐藏",
    exit: "退出",
    unavailable: "未读取到额度数据",
    openCodex: "打开 Codex",
    checkingUpdate: "正在检查更新...",
    updateAvailable: "发现新版本",
    updateDownloading: "正在下载更新",
    updateInstalling: "正在安装更新",
    updateReady: "更新已安装，重启后生效",
    updateFailed: "更新检查失败",
    settings: "设置",
    close: "关闭",
    codexPath: "Codex 路径",
    chooseCodex: "选择 codex.exe",
    updateProxy: "更新代理",
    refreshInterval: "刷新分钟",
    language: "语言",
    autoUpdate: "自动更新",
    autoUpdateHint: "更新依赖 GitHub，网络不可达时可能需要配置代理。",
    updateProxyHint: "仅用于 GitHub 自动更新，不影响 Codex CLI。",
    save: "保存",
    cancel: "取消",
    settingsSaved: "设置已保存",
    codexPathPlaceholder: "留空自动探测",
    updateProxyPlaceholder: "http://127.0.0.1:7890"
  },
  en: {
    brandName: "Codex Quota",
    loading: "Loading",
    ready: "Quota healthy",
    low: "Quota low",
    empty: "Quota empty",
    error: "Read failed",
    remaining: "Remaining",
    primaryFallback: "5h window",
    secondaryFallback: "7d window",
    plan: "Plan",
    unknown: "Unknown",
    noData: "No data",
    reading: "Reading Codex quota...",
    refreshedAt: "Refreshed",
    nextReset: "Reset",
    pin: "Pin",
    unpin: "Unpin",
    refresh: "Refresh",
    hide: "Hide",
    exit: "Exit",
    unavailable: "No quota data",
    openCodex: "Open Codex",
    checkingUpdate: "Checking for updates...",
    updateAvailable: "Update available",
    updateDownloading: "Downloading update",
    updateInstalling: "Installing update",
    updateReady: "Update installed. Restart to apply.",
    updateFailed: "Update check failed",
    settings: "Settings",
    close: "Close",
    codexPath: "Codex path",
    chooseCodex: "Choose codex.exe",
    updateProxy: "Update proxy",
    refreshInterval: "Refresh min",
    language: "Language",
    autoUpdate: "Auto update",
    autoUpdateHint: "Updates depend on GitHub. Configure a proxy if the network cannot reach it.",
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
  settingsBtn: document.getElementById("settingsBtn"),
  pinBtn: document.getElementById("pinBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  minimizeBtn: document.getElementById("minimizeBtn"),
  closeBtn: document.getElementById("closeBtn"),
  liquidMeter: document.getElementById("liquidMeter"),
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
  updateProxyLabel: document.getElementById("updateProxyLabel"),
  updateProxyInput: document.getElementById("updateProxyInput"),
  updateProxyHint: document.getElementById("updateProxyHint"),
  refreshIntervalLabel: document.getElementById("refreshIntervalLabel"),
  refreshIntervalInput: document.getElementById("refreshIntervalInput"),
  languageLabel: document.getElementById("languageLabel"),
  localeSelect: document.getElementById("localeSelect"),
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
  savingSettings: false
};

initializeActionIcons();
bindEvents();
initialize();

function bindEvents() {
  els.widget.addEventListener("pointerdown", startWindowDrag);

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
  els.minimizeBtn.addEventListener("click", () => invoke("hide_window"));
  els.closeBtn.addEventListener("click", () => invoke("close_app"));
  els.settingsCloseBtn.addEventListener("click", closeSettingsPanel);
  els.cancelSettingsBtn.addEventListener("click", closeSettingsPanel);
  els.saveSettingsBtn.addEventListener("click", saveSettings);
  els.chooseCodexBtn.addEventListener("click", chooseCodexPath);
  els.autoUpdateSwitch.addEventListener("change", syncAutoUpdateDraft);
  els.localeSelect.addEventListener("change", () => selectSettingsLocale(els.localeSelect.value));
}

async function startWindowDrag(event) {
  const noDragTarget =
    event.target instanceof Element
      ? event.target.closest("button, a, input, textarea, select, [data-no-drag]")
      : null;

  if (event.button !== 0 || noDragTarget) return;
  event.preventDefault();

  if (!window.__TAURI_INTERNALS__) return;

  try {
    await getCurrentWindow().startDragging();
  } catch (error) {
    console.error("启动窗口拖动失败", error);
  }
}

async function initialize() {
  render();
  await loadSettings();

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
  const text = i18n[state.locale];
  const quota = state.quota;
  const hasQuota = Boolean(quota);
  const remaining = typeof quota?.remainingPercent === "number" ? quota.remainingPercent : null;
  const visualState = getVisualState(remaining);
  const mainState = state.error && !hasQuota ? "error" : state.loading ? "loading" : visualState;
  const updateStatusText = formatUpdateStatus(text);

  document.documentElement.lang = state.locale === "zh" ? "zh-CN" : "en";
  els.body.dataset.state = mainState;

  els.brandName.textContent = text.brandName;
  els.remainingLabel.textContent = text.remaining;
  els.planLabel.textContent = text.plan;

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
    els.statusText.textContent = statusLabel(quota, text);
  }

  els.remaining.textContent = remaining === null ? "--%" : `${remaining}%`;
  els.liquidFill.style.height = `${remaining === null ? 0 : remaining}%`;
  els.liquidMeter.dataset.level = visualState;

  renderWindow(quota?.primary, els.primaryLabel, els.primaryText, text.primaryFallback, text);
  renderWindow(quota?.secondary, els.secondaryLabel, els.secondaryText, text.secondaryFallback, text);
  els.planText.textContent = quota?.planType || text.unknown;
  renderSettingsPanel(text);
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
  state.settings = normalizeSettings(settings);
  state.locale = state.settings.locale;
  state.settingsDraft = { ...state.settings };
  render();
}

function normalizeSettings(settings) {
  const refreshIntervalMinutes = Number(settings?.refreshIntervalMinutes);
  return {
    codexCliPath: typeof settings?.codexCliPath === "string" ? settings.codexCliPath : "",
    updateProxy: typeof settings?.updateProxy === "string" ? settings.updateProxy : "",
    refreshIntervalMinutes:
      Number.isInteger(refreshIntervalMinutes) && refreshIntervalMinutes >= 1 && refreshIntervalMinutes <= 1440
        ? refreshIntervalMinutes
        : DEFAULT_SETTINGS.refreshIntervalMinutes,
    locale: settings?.locale === "en" ? "en" : "zh",
    autoUpdateEnabled:
      typeof settings?.autoUpdateEnabled === "boolean" ? settings.autoUpdateEnabled : DEFAULT_SETTINGS.autoUpdateEnabled
  };
}

function openSettingsPanel() {
  state.settingsDraft = { ...state.settings };
  state.settingsOpen = true;
  fillSettingsForm();
  render();
}

function closeSettingsPanel() {
  state.settingsOpen = false;
  state.settingsDraft = { ...state.settings };
  render();
}

function fillSettingsForm() {
  els.codexPathInput.value = state.settingsDraft.codexCliPath || "";
  els.updateProxyInput.value = state.settingsDraft.updateProxy || "";
  els.refreshIntervalInput.value = String(state.settingsDraft.refreshIntervalMinutes || DEFAULT_SETTINGS.refreshIntervalMinutes);
  els.autoUpdateSwitch.checked = Boolean(state.settingsDraft.autoUpdateEnabled);
  els.localeSelect.value = state.settingsDraft.locale === "en" ? "en" : "zh";
}

function renderSettingsPanel(text) {
  els.settingsPanel.hidden = !state.settingsOpen;
  els.settingsTitle.textContent = text.settings;
  els.codexPathLabel.textContent = text.codexPath;
  els.autoUpdateLabel.textContent = text.autoUpdate;
  els.autoUpdateHint.textContent = text.autoUpdateHint;
  els.updateProxyLabel.textContent = text.updateProxy;
  els.updateProxyHint.textContent = text.updateProxyHint;
  els.refreshIntervalLabel.textContent = text.refreshInterval;
  els.languageLabel.textContent = text.language;
  els.codexPathInput.placeholder = text.codexPathPlaceholder;
  els.updateProxyInput.placeholder = text.updateProxyPlaceholder;
  els.cancelSettingsBtn.textContent = text.cancel;
  els.saveSettingsText.textContent = state.savingSettings ? text.loading : text.save;
  els.saveSettingsBtn.disabled = state.savingSettings;
  els.autoUpdateSwitch.checked = Boolean(state.settingsDraft.autoUpdateEnabled);
  els.localeSelect.value = state.settingsDraft.locale === "en" ? "en" : "zh";
}

function syncAutoUpdateDraft() {
  state.settingsDraft.autoUpdateEnabled = els.autoUpdateSwitch.checked;
  render();
}

function selectSettingsLocale(locale) {
  state.settingsDraft.locale = locale === "en" ? "en" : "zh";
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
    }
  } catch (error) {
    showError(error);
  }
}

async function saveSettings() {
  if (state.savingSettings) return;

  const nextSettings = collectSettingsDraft();
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
    autoUpdateEnabled: els.autoUpdateSwitch.checked
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
    [els.settingsBtn, "settings"],
    [els.pinBtn, "pin"],
    [els.refreshBtn, "refresh-cw"],
    [els.minimizeBtn, "minus"],
    [els.closeBtn, "x"],
    [els.settingsCloseBtn, "x"],
    [els.chooseCodexBtn, "folder-open"]
  ].forEach(([button, iconName]) => {
    setActionButtonIcon(button, iconName);
  });
}

function updateActionButton(button, iconName, label) {
  button.title = label;
  button.setAttribute("aria-label", label);
  button.classList.toggle("active", button === els.pinBtn && state.alwaysOnTop);

  // 图标 DOM 初始化后保持稳定，只在置顶状态切换时替换对应图标，避免每次刷新重建按钮。
  if (button.dataset.iconName === iconName) return;
  setActionButtonIcon(button, iconName);
}

function setActionButtonIcon(button, iconName) {
  button.dataset.iconName = iconName;
  button.replaceChildren(createActionIcon(iconName));
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

function renderWindow(windowData, labelEl, valueEl, fallbackLabel, text) {
  labelEl.textContent = formatWindowLabel(windowData?.windowDurationMins, fallbackLabel, text);
  if (!windowData || typeof windowData.remainingPercent !== "number") {
    valueEl.textContent = "--";
    return;
  }
  valueEl.textContent = `${windowData.remainingPercent}%`;
}

function formatWindowLabel(minutes, fallbackLabel, text) {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) return fallbackLabel;
  if (minutes % 10080 === 0) {
    const value = minutes / 10080;
    return state.locale === "zh" ? `${value}周窗口` : `${value}w window`;
  }
  if (minutes % 1440 === 0) {
    const value = minutes / 1440;
    return state.locale === "zh" ? `${value}天窗口` : `${value}d window`;
  }
  if (minutes % 60 === 0) {
    const value = minutes / 60;
    return state.locale === "zh" ? `${value}小时窗口` : `${value}h window`;
  }
  return state.locale === "zh" ? `${minutes}分钟窗口` : `${minutes}m window`;
}

function statusLabel(quota, text) {
  if (!quota) return text.noData;
  const fetchedAt = quota.fetchedAt ? formatDate(quota.fetchedAt) : "";
  const resetsAt = quota.resetsAt ? formatDate(quota.resetsAt) : "";
  if (resetsAt) return `${text.refreshedAt} ${fetchedAt} · ${text.nextReset} ${resetsAt}`;
  return fetchedAt ? `${text.refreshedAt} ${fetchedAt}` : text.noData;
}

function getVisualState(remaining) {
  if (remaining === null) return "unknown";
  if (remaining === 0) return "empty";
  if (remaining < 10) return "low";
  return "ready";
}

function stateLabel(visualState, text) {
  if (visualState === "empty") return text.empty;
  if (visualState === "low") return text.low;
  if (visualState === "ready") return text.ready;
  return text.unavailable;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(state.locale === "zh" ? "zh-CN" : "en-US", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
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
