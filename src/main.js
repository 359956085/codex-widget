import "./styles.css";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createElement as createLucideElement, Minus, Pin, PinOff, RefreshCw, X } from "lucide";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const ACTION_ICONS = {
  minus: Minus,
  pin: Pin,
  "pin-off": PinOff,
  "refresh-cw": RefreshCw,
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
    openCodex: "打开 Codex"
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
    openCodex: "Open Codex"
  }
};

const els = {
  body: document.body,
  trafficLight: document.getElementById("trafficLight"),
  brandName: document.getElementById("brandName"),
  stateText: document.getElementById("stateText"),
  langBtn: document.getElementById("langBtn"),
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
  widget: document.querySelector(".widget")
};

const state = {
  locale: localStorage.getItem("codex-quota-locale") || "zh",
  quota: null,
  loading: false,
  error: "",
  alwaysOnTop: true,
  resetTimer: null
};

initializeActionIcons();
bindEvents();
initialize();

function bindEvents() {
  els.widget.addEventListener("pointerdown", startWindowDrag);

  els.langBtn.addEventListener("click", () => {
    state.locale = state.locale === "zh" ? "en" : "zh";
    localStorage.setItem("codex-quota-locale", state.locale);
    render();
  });

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
  window.setInterval(refreshQuota, REFRESH_INTERVAL_MS);
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

  state.resetTimer = window.setTimeout(refreshQuota, Math.min(delay, REFRESH_INTERVAL_MS));
}

function render() {
  const text = i18n[state.locale];
  const quota = state.quota;
  const hasQuota = Boolean(quota);
  const remaining = typeof quota?.remainingPercent === "number" ? quota.remainingPercent : null;
  const visualState = getVisualState(remaining);
  const mainState = state.error && !hasQuota ? "error" : state.loading ? "loading" : visualState;

  document.documentElement.lang = state.locale === "zh" ? "zh-CN" : "en";
  els.body.dataset.state = mainState;

  els.brandName.textContent = text.brandName;
  els.remainingLabel.textContent = text.remaining;
  els.planLabel.textContent = text.plan;
  els.langBtn.textContent = state.locale === "zh" ? "EN" : "中";

  updateActionButton(els.pinBtn, state.alwaysOnTop ? "pin" : "pin-off", state.alwaysOnTop ? text.unpin : text.pin);
  updateActionButton(els.refreshBtn, "refresh-cw", text.refresh);
  updateActionButton(els.minimizeBtn, "minus", text.hide);
  updateActionButton(els.closeBtn, "x", text.exit);

  els.trafficLight.className = `traffic-light ${mainState}`;
  els.statusDot.className = `status-dot ${state.error ? "error" : mainState}`;

  if (state.error) {
    els.stateText.textContent = hasQuota ? stateLabel(visualState, text) : text.error;
    els.statusText.textContent = state.error;
  } else if (state.loading) {
    els.stateText.textContent = text.loading;
    els.statusText.textContent = text.reading;
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
}

function initializeActionIcons() {
  [
    [els.pinBtn, "pin"],
    [els.refreshBtn, "refresh-cw"],
    [els.minimizeBtn, "minus"],
    [els.closeBtn, "x"]
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
  if (remaining < 20) return "low";
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
