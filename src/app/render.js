import { APP_VERSION_LABEL, i18n, WIDGET_MODES } from "./constants.js";
import {
  formatResetCredits,
  formatWindowLabel,
  getVisualState,
  selectedMeterWindow,
  stateLabel,
  statusLabel,
  waterFillPercent
} from "./formatters.js";
import { clamp } from "./geometry.js";
import { updateActionButton } from "./icons.js";
import { formatUpdateStatus } from "./update-status.js";
import { updateGauge } from "../components/gauge.js";

export function createRenderer({ els, state, getLocale, getTheme, onVersionClick, settingsView }) {
  function render() {
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

    document.documentElement.lang = activeLocale === "zh" ? "zh-CN" : "en";
    els.body.dataset.state = mainState;
    els.body.dataset.widgetMode = state.widgetMode;
    els.body.dataset.ballDock = state.ballDock || "none";
    els.body.dataset.theme = activeTheme;

    renderBrandName(text);
    els.remainingLabel.textContent = text.remaining;
    els.remainingLabel.hidden = state.widgetMode === WIDGET_MODES.BALL;
    els.planLabel.textContent = text.plan;

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
    els.planText.textContent = formatResetCredits(quota?.resetCredits?.availableCount);
    settingsView.renderSettingsPanel(text);
  }

  function renderBrandName(text) {
    const title = document.createElement("span");
    title.className = "brand-title";
    title.textContent = text.brandName;
    els.brandName.setAttribute("aria-label", APP_VERSION_LABEL ? `${text.brandName} ${APP_VERSION_LABEL}` : text.brandName);

    if (!APP_VERSION_LABEL) {
      els.brandName.replaceChildren(title);
      return;
    }

    const versionButton = document.createElement("button");
    versionButton.type = "button";
    versionButton.className = "version-badge";
    versionButton.textContent = APP_VERSION_LABEL;
    versionButton.title = text.checkUpdate;
    versionButton.setAttribute("aria-label", `${text.checkUpdate} ${APP_VERSION_LABEL}`);
    versionButton.setAttribute("data-no-drag", "");
    versionButton.addEventListener("click", onVersionClick);
    els.brandName.replaceChildren(title, versionButton);
  }

  return { render };
}

function renderWindow(windowData, labelEl, valueEl, fallbackLabel, text, locale) {
  labelEl.textContent = formatWindowLabel(windowData?.windowDurationMins, fallbackLabel, text, locale);
  if (!windowData || typeof windowData.remainingPercent !== "number") {
    valueEl.textContent = "--";
    return;
  }
  valueEl.textContent = `${windowData.remainingPercent}%`;
}
