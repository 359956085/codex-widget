import { APP_VERSION_LABEL, i18n, WIDGET_MODES } from "./constants.js";
import {
  formatResetCreditExpiries,
  formatResetCredits,
  formatQuotaEstimateTooltip,
  formatQuotaEstimateUsd,
  formatDateTimeOrPlaceholder,
  formatWindowLabel,
  getVisualState,
  selectedMeterWindow,
  stateLabel,
  statusLabel
} from "./formatters.js";
import { removeAttribute, setAttribute, setDatasetValue, setText } from "./dom-utils.js";
import { clamp } from "./geometry.js";
import { createActionIcon, updateActionButton } from "./icons.js";
import { resolveDataBars } from "./settings-model.js";
import { formatUpdateStatus } from "./update-status.js";
import { activeError } from "./state.js";
import { createMeterController } from "../components/meters/meter-controller.js";

export function createRenderer({ els, state, getLocale, getTheme, onVersionClick, settingsView }) {
  const brandView = createBrandView();
  const meterController = createMeterController(els.meterHost);
  const dataBarViews = els.dataBarCards.map((card) => createDataBarView(card, state));

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
    // 设置面板内即时预览；关闭或取消后重新使用已提交配置。
    const activeSettings = state.settingsOpen ? state.settingsDraft : state.settings;
    const meterWindowData = selectedMeterWindow(quota, activeSettings.meterWindow);
    const dataBars = resolveDataBars(activeSettings.dataBars, quota?.planType);
    const remaining = typeof meterWindowData?.remainingPercent === "number" ? meterWindowData.remainingPercent : null;
    const remainingValue = remaining === null ? 0 : clamp(remaining, 0, 100);
    const visualState = getVisualState(remaining);
    const error = activeError(state);
    const isInitialQuotaLoading = state.loading && !hasQuota;
    const mainState = error && !hasQuota ? "error" : state.loading ? "loading" : visualState;
    const updateStatusText = formatUpdateStatus(text, state.updateStatus);

    return {
      activeLocale,
      activeTheme,
      text,
      quota,
      dataBars,
      hasQuota,
      remaining,
      remainingValue,
      visualState,
      error,
      isInitialQuotaLoading,
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

  function renderHeader({ text }) {
    renderWidgetHint(text);
    renderBrandName(text);
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

  function renderStatus({ activeLocale, error, hasQuota, mainState, quota, text, updateStatusText, visualState }) {
    setClassName(els.trafficLight, `traffic-light ${mainState}`);
    setClassName(els.statusDot, `status-dot ${error ? "error" : mainState}`);

    if (error) {
      setText(els.stateText, hasQuota ? stateLabel(visualState, text) : text.error);
      setText(els.statusText, error);
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
    meterController.update({
      theme: activeTheme,
      percent: remaining,
      angle: remainingValue * 3.6,
      level: visualState,
      label: text.remaining,
      mode: state.widgetMode,
      dock: state.ballDock || "none"
    });
  }

  function renderQuotaCards(context) {
    dataBarViews.forEach((view, index) => view.render(context.dataBars[index], context));
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
      setAttribute(els.widget, "role", "button");
      setAttribute(els.widget, "tabindex", "0");
      return;
    }

    removeTooltip(els.widget);
    removeAttribute(els.widget, "title");
    removeAttribute(els.widget, "aria-label");
    removeAttribute(els.widget, "role");
    removeAttribute(els.widget, "tabindex");
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

function createDataBarView(card, state) {
  let activeContent = null;
  let elements = null;

  function render(content, { activeLocale, isInitialQuotaLoading, quota, text }) {
    if (activeContent !== content) {
      activeContent = content;
      elements = buildDataBar(card, content);
    }

    if (content === "fiveHour") {
      renderWindowData(elements, quota?.primary, text.primaryFallback, text.primaryResetInlineLabel, text, activeLocale);
      return;
    }
    if (content === "weekly") {
      renderWindowData(elements, quota?.secondary, text.secondaryFallback, text.secondaryResetLabel, text, activeLocale);
      return;
    }
    if (content === "resetCredits") {
      setText(elements.label, text.plan);
      setText(elements.subLabel, text.resetCreditExpiryPrefix);
      setText(elements.subValue, formatResetCreditExpiries(state.resetCreditExpiries, state.resetCreditExpiriesStatus));
      setText(elements.value, formatResetCredits(quota?.resetCredits?.availableCount));
      return;
    }

    renderEstimateData(card, elements, quota?.quotaEstimate, text, activeLocale, isInitialQuotaLoading);
  }

  return { render };
}

function buildDataBar(card, content) {
  const isEstimate = content === "quotaEstimate";
  card.classList.toggle("estimate-card", isEstimate);
  card.dataset.content = content;

  if (isEstimate) {
    setAttribute(card, "role", "group");
    setAttribute(card, "tabindex", "0");
    return buildEstimateCard(card);
  }

  removeTooltip(card);
  removeAttribute(card, "title");
  removeAttribute(card, "aria-label");
  removeAttribute(card, "role");
  removeAttribute(card, "tabindex");
  return content === "resetCredits"
    ? buildStandardCard(card, content, "reset-credit")
    : buildStandardCard(card, content, content === "fiveHour" ? "clock-3" : "calendar-days");
}

function buildStandardCard(card, content, iconName) {
  const icon = createQuotaIcon(content, iconName);
  const copy = document.createElement("span");
  const label = document.createElement("span");
  const subtext = document.createElement("small");
  const subLabel = document.createElement("span");
  const subValue = document.createElement("span");
  const value = document.createElement("strong");

  copy.className = "quota-copy";
  subtext.className = "quota-subtext";
  subLabel.className = "quota-sub-label";
  subValue.className = "quota-sub-value";
  subtext.append(subLabel, subValue);
  copy.append(label, subtext);
  card.replaceChildren(icon, copy, value);
  return { label, subLabel, subValue, value };
}

function buildEstimateCard(card) {
  const icon = createQuotaIcon("quotaEstimate", "wallet-cards");
  const label = document.createElement("span");
  const previous = createEstimatePeriod();
  const current = createEstimatePeriod();

  label.className = "estimate-title";
  card.replaceChildren(icon, label, createEstimateDivider(), previous.root, createEstimateDivider(), current.root);
  return {
    label,
    previousLabel: previous.label,
    previousValue: previous.value,
    currentLabel: current.label,
    currentValue: current.value
  };
}

function createQuotaIcon(content, iconName) {
  const icon = document.createElement("span");
  icon.className = "quota-icon";
  icon.dataset.quotaIcon = content;
  icon.setAttribute("aria-hidden", "true");
  icon.appendChild(createActionIcon(iconName));
  return icon;
}

function createEstimatePeriod() {
  const root = document.createElement("span");
  const label = document.createElement("small");
  const value = document.createElement("strong");
  root.className = "estimate-period";
  value.className = "estimate-value";
  root.append(label, value);
  return { root, label, value };
}

function createEstimateDivider() {
  const divider = document.createElement("span");
  divider.className = "estimate-divider";
  divider.setAttribute("aria-hidden", "true");
  return divider;
}

function renderWindowData(elements, windowData, fallbackLabel, resetLabel, text, locale) {
  renderWindow(windowData, elements.label, elements.value, fallbackLabel, text, locale);
  setText(elements.subLabel, resetLabel);
  setText(elements.subValue, formatDateTimeOrPlaceholder(windowData?.resetsAt, locale));
}

function renderEstimateData(card, elements, estimate, text, locale, isInitialQuotaLoading) {
  setText(elements.label, text.estimateTitle);
  setText(elements.previousLabel, text.estimatePrevious);
  setText(elements.currentLabel, text.estimateCurrent);
  setText(elements.previousValue, formatQuotaEstimateUsd(estimate?.previous, locale));
  setText(elements.currentValue, formatQuotaEstimateUsd(estimate?.current, locale));
  const tooltip = formatQuotaEstimateTooltip(estimate, text, locale, { loading: isInitialQuotaLoading });
  setTooltip(card, tooltip);
  setAttribute(card, "aria-label", tooltip);
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
