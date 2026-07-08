import { APP_VERSION_LABEL, i18n, WIDGET_MODES } from "./constants.js";
import {
  formatResetCreditExpiries,
  formatResetCredits,
  formatDateTimeOrPlaceholder,
  formatTimeOrPlaceholder,
  formatWindowLabel,
  getVisualState,
  selectedMeterWindow,
  stateLabel,
  statusLabel,
  waterFillPercent
} from "./formatters.js";
import { removeAttribute, setAttribute, setDatasetValue, setStyleValue, setText } from "./dom-utils.js";
import { clamp } from "./geometry.js";
import { updateActionButton } from "./icons.js";
import { formatUpdateStatus } from "./update-status.js";
import { updateGauge } from "../components/gauge.js";

export function createRenderer({ els, state, getLocale, getTheme, onVersionClick, settingsView }) {
  const brandView = createBrandView();

  function render() {
    const context = createRenderContext();

    renderDocumentState(context);
    renderHeader(context);
    renderActions(context);
    renderStatus(context);
    renderMeter(context);
    renderQuotaCards(context);
    settingsView.renderSettingsPanel(context.text);
  }

  function createRenderContext() {
    const activeLocale = getLocale();
    const activeTheme = getTheme();
    const text = i18n[activeLocale];
    const quota = state.quota;
    const hasQuota = Boolean(quota);
    const meterWindow = state.settingsOpen ? state.settingsDraft.meterWindow : state.settings.meterWindow;
    const meterWindowData = selectedMeterWindow(quota, meterWindow);
    const remaining = typeof meterWindowData?.remainingPercent === "number" ? meterWindowData.remainingPercent : null;
    const remainingValue = remaining === null ? 0 : clamp(remaining, 0, 100);
    const visualState = getVisualState(remaining);
    const mainState = state.error && !hasQuota ? "error" : state.loading ? "loading" : visualState;
    const updateStatusText = formatUpdateStatus(text, state.updateStatus);

    return {
      activeLocale,
      activeTheme,
      text,
      quota,
      hasQuota,
      remaining,
      remainingValue,
      visualState,
      mainState,
      updateStatusText
    };
  }

  function renderDocumentState({ activeLocale, activeTheme, mainState }) {
    document.documentElement.lang = activeLocale === "zh" ? "zh-CN" : "en";
    setDatasetValue(els.body, "state", mainState);
    setDatasetValue(els.body, "widgetMode", state.widgetMode);
    setDatasetValue(els.body, "ballDock", state.ballDock || "none");
    setDatasetValue(els.body, "theme", activeTheme);
  }

  function renderHeader({ activeTheme, text }) {
    renderWidgetHint(text);
    renderBrandName(text);
    setText(els.remainingLabel, text.remaining);
    els.remainingLabel.hidden =
      state.widgetMode === WIDGET_MODES.BALL &&
      (activeTheme !== "default" || (state.ballDock || "none") !== "none");
  }

  function renderActions({ text }) {
    updateActionButton(els.modeBtn, "circle-dot", text.ballMode, state.widgetMode === WIDGET_MODES.BALL);
    updateActionButton(els.settingsBtn, "settings", text.settings);
    updateActionButton(
      els.pinBtn,
      state.alwaysOnTop ? "pin" : "pin-off",
      state.alwaysOnTop ? text.unpin : text.pin,
      state.alwaysOnTop
    );
    updateActionButton(els.refreshBtn, "refresh-cw", text.refresh);
    updateActionButton(els.minimizeBtn, "minus", text.hide);
    updateActionButton(els.closeBtn, "x", text.exit);
    updateActionButton(els.settingsCloseBtn, "x", text.close);
    updateActionButton(els.chooseCodexBtn, "folder-open", text.chooseCodex);
  }

  function renderStatus({ activeLocale, hasQuota, mainState, quota, text, updateStatusText, visualState }) {
    setClassName(els.trafficLight, `traffic-light ${mainState}`);
    setClassName(els.statusDot, `status-dot ${state.error ? "error" : mainState}`);

    if (state.error) {
      setText(els.stateText, hasQuota ? stateLabel(visualState, text) : text.error);
      setText(els.statusText, state.error);
    } else if (state.loading) {
      setText(els.stateText, text.loading);
      setText(els.statusText, text.reading);
    } else if (updateStatusText) {
      setText(els.stateText, stateLabel(visualState, text));
      setText(els.statusText, updateStatusText);
    } else {
      setText(els.stateText, stateLabel(visualState, text));
      setText(els.statusText, statusLabel(quota, text, activeLocale));
    }
    setTooltip(els.statusText, els.statusText.textContent);
  }

  function renderMeter({ activeTheme, remaining, remainingValue, text, visualState }) {
    setText(els.remaining, remaining === null ? "--%" : `${remaining}%`);
    setStyleValue(els.liquidFill, "height", `${waterFillPercent(remaining, activeTheme)}%`);
    els.liquidMeter.style.setProperty("--remaining-angle", `${remainingValue * 3.6}deg`);
    setDatasetValue(els.liquidMeter, "level", visualState);
    updateGauge({
      root: els.gaugeLayer,
      percent: remaining,
      level: visualState,
      label: text.remaining,
      mode: state.widgetMode,
      dock: state.ballDock || "none"
    });
  }

  function renderQuotaCards({ activeLocale, quota, text }) {
    setText(els.planLabel, text.plan);
    setText(els.primaryResetLabel, text.primaryResetInlineLabel);
    setText(els.secondaryResetLabel, text.secondaryResetLabel);
    setText(els.planExpiryLabel, text.resetCreditExpiryPrefix);
    renderWindow(quota?.primary, els.primaryLabel, els.primaryText, text.primaryFallback, text, activeLocale);
    renderWindow(quota?.secondary, els.secondaryLabel, els.secondaryText, text.secondaryFallback, text, activeLocale);
    setText(els.primaryResetValue, formatTimeOrPlaceholder(quota?.primary?.resetsAt, activeLocale));
    setText(els.secondaryResetValue, formatDateTimeOrPlaceholder(quota?.secondary?.resetsAt, activeLocale));
    setText(els.planText, formatResetCredits(quota?.resetCredits?.availableCount));
    setText(
      els.planExpiryValue,
      formatResetCreditExpiries(state.resetCreditExpiries, state.resetCreditExpiriesStatus)
    );
  }

  function renderBrandName(text) {
    setText(brandView.title, text.brandName);
    setAttribute(els.brandName, "aria-label", APP_VERSION_LABEL ? `${text.brandName} ${APP_VERSION_LABEL}` : text.brandName);
    if (!brandView.versionButton) return;

    setTooltip(brandView.versionButton, text.checkUpdate);
    removeAttribute(brandView.versionButton, "title");
    setAttribute(brandView.versionButton, "aria-label", `${text.checkUpdate} ${APP_VERSION_LABEL}`);
  }

  function renderWidgetHint(text) {
    if (state.widgetMode === WIDGET_MODES.BALL) {
      setTooltip(els.widget, text.ballRestoreHint);
      removeAttribute(els.widget, "title");
      setAttribute(els.widget, "aria-label", text.ballRestoreHint);
      return;
    }

    removeTooltip(els.widget);
    removeAttribute(els.widget, "title");
    removeAttribute(els.widget, "aria-label");
  }

  function createBrandView() {
    const title = document.createElement("span");
    title.className = "brand-title";

    if (!APP_VERSION_LABEL) {
      els.brandName.replaceChildren(title);
      return { title, versionButton: null };
    }

    const versionButton = document.createElement("button");
    versionButton.id = "versionBtn";
    versionButton.type = "button";
    versionButton.className = "version-badge";
    versionButton.textContent = APP_VERSION_LABEL;
    versionButton.setAttribute("data-no-drag", "");
    versionButton.addEventListener("click", onVersionClick);
    els.brandName.replaceChildren(title, versionButton);
    return { title, versionButton };
  }

  return { render };
}

function renderWindow(windowData, labelEl, valueEl, fallbackLabel, text, locale) {
  setText(labelEl, formatWindowLabel(windowData?.windowDurationMins, fallbackLabel, text, locale));
  if (!windowData || typeof windowData.remainingPercent !== "number") {
    setText(valueEl, "--");
    return;
  }
  setText(valueEl, `${windowData.remainingPercent}%`);
}

function setClassName(element, value) {
  if (element.className !== value) {
    element.className = value;
  }
}

function setTooltip(element, value) {
  const nextValue = value?.trim() || "";
  if (!nextValue) {
    removeTooltip(element);
    return;
  }
  if (element.dataset.tooltip !== nextValue) {
    element.dataset.tooltip = nextValue;
  }
}

function removeTooltip(element) {
  if (element.dataset.tooltip !== undefined) {
    delete element.dataset.tooltip;
  }
}
