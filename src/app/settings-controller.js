import { setAttribute, setText } from "./dom-utils.js";
import { createLifecycle } from "./lifecycle.js";
import { DATA_BAR_CONTENTS, DEFAULT_SETTINGS, LOG_LEVELS, METER_WINDOWS, THEMES } from "./constants.js";
import { createCustomSelectController } from "./custom-select.js";
import { createDialogFocusManager } from "./dialog-focus.js";
import { detectMacOS } from "./platform.js";
import { syncSettingsDraftFromSettings } from "./state.js";
import {
  normalizeDataBarContent,
  normalizeDataBars,
  normalizeInputValue,
  normalizeLogLevel,
  normalizeMeterWindow,
  normalizeTheme,
  resolveDataBars
} from "./settings-model.js";

export function createSettingsController({
  els,
  state,
  service,
  render,
  renderLocale,
  persistSettings,
  normalizeError,
  readCurrentWindowPosition,
  mergeWindowPosition,
  setUpdateStatus,
  scheduleAutoRefresh,
  refreshQuota,
  scheduleUpdateChecks,
  logger,
  clearPanelClick,
  isMacOS = detectMacOS()
}) {
  const lifecycle = createLifecycle();
  render = lifecycle.guard(render);
  const customSelects = createCustomSelectController({
    shells: els.customSelectShells,
    onChange: handleCustomSelectChange
  });
  const focusManager = createDialogFocusManager({
    dialog: els.settingsPanel,
    initialFocus: els.settingsCloseBtn,
    onEscape: closeSettingsPanel
  });
  const selectOptionSignatures = new WeakMap();
  const customSelectHandlers = {
    themeSelect: selectSettingsTheme,
    localeSelect: selectSettingsLocale,
    meterWindowSelect: selectMeterWindow,
    dataBar1Select: (value) => selectDataBar(0, value),
    dataBar2Select: (value) => selectDataBar(1, value),
    dataBar3Select: (value) => selectDataBar(2, value),
    logLevelSelect: selectLogLevel
  };
  const selectOptionConfigs = [
    {
      select: els.themeSelect,
      registry: THEMES,
      currentValue: () => normalizeTheme(state.settingsDraft.theme)
    },
    {
      select: els.meterWindowSelect,
      registry: METER_WINDOWS,
      currentValue: () => normalizeMeterWindow(state.settingsDraft.meterWindow)
    },
    ...els.dataBarSelects.map((select, index) => ({
      select,
      registry: DATA_BAR_CONTENTS,
      currentValue: () => resolveDataBars(state.settingsDraft.dataBars, state.quota?.planType)[index]
    })),
    {
      select: els.logLevelSelect,
      registry: LOG_LEVELS,
      currentValue: () => normalizeLogLevel(state.settingsDraft.logLevel)
    }
  ];

  function bindEvents() {
    if (!lifecycle.bind()) return;
    focusManager.bindEvents();
    lifecycle.listen(els.settingsBtn, "click", openSettingsPanel);
    lifecycle.listen(els.settingsCloseBtn, "click", closeSettingsPanel);
    lifecycle.listen(els.cancelSettingsBtn, "click", closeSettingsPanel);
    lifecycle.listen(els.saveSettingsBtn, "click", saveSettings);
    lifecycle.listen(els.chooseCodexBtn, "click", chooseCodexPath);
    lifecycle.listen(els.autoUpdateSwitch, "change", syncAutoUpdateDraft);
    lifecycle.listen(els.autoStartSwitch, "change", syncAutoStartDraft);
    lifecycle.listen(els.hideDockIconSwitch, "change", syncHideDockIconDraft);
    customSelects.bindEvents();
  }

  function openSettingsPanel() {
    if (lifecycle.destroyed) return;
    clearPanelClick();
    syncSettingsDraftFromSettings(state);
    state.settingsOpen = true;
    fillSettingsForm();
    render();
    focusManager.activate();
  }

  function closeSettingsPanel() {
    state.settingsOpen = false;
    syncSettingsDraftFromSettings(state);
    customSelects.close();
    render();
    focusManager.deactivate();
  }

  function fillSettingsForm() {
    els.codexPathInput.value = state.settingsDraft.codexCliPath || "";
    els.updateProxyInput.value = state.settingsDraft.updateProxy || "";
    els.refreshIntervalInput.value = String(state.settingsDraft.refreshIntervalMinutes || DEFAULT_SETTINGS.refreshIntervalMinutes);
    syncSettingsControls(renderLocale());
  }

  function renderSettingsPanel(text) {
    if (lifecycle.destroyed) return;
    els.settingsPanel.hidden = !state.settingsOpen;
    if (!state.settingsOpen) return;

    renderSettingsLabels(text);
    renderSettingsSaveState(text);
    syncSettingsControls(renderLocale());
  }

  function renderSettingsLabels(text) {
    setText(els.settingsTitle, text.settings);
    setText(els.codexPathLabel, text.codexPath);
    setText(els.autoUpdateLabel, text.autoUpdate);
    setText(els.autoUpdateHint, text.autoUpdateHint);
    setText(els.autoStartLabel, text.autoStart);
    setText(els.autoStartHint, text.autoStartHint);
    setText(els.hideDockIconLabel, text.hideDockIcon);
    setText(els.hideDockIconHint, text.hideDockIconHint);
    setText(els.updateProxyLabel, text.updateProxy);
    setText(els.updateProxyHint, text.updateProxyHint);
    setText(els.refreshIntervalLabel, text.refreshInterval);
    setText(els.themeLabel, text.theme);
    setText(els.languageLabel, text.language);
    setText(els.meterWindowLabel, text.meterWindow);
    els.dataBarLabels.forEach((label, index) => {
      setText(label, text[`dataBar${index + 1}`]);
    });
    setText(els.logLevelLabel, text.logLevel);
    setAttribute(els.codexPathInput, "placeholder", text.codexPathPlaceholder);
    setAttribute(els.updateProxyInput, "placeholder", text.updateProxyPlaceholder);
    setText(els.cancelSettingsBtn, text.cancel);
  }

  function renderSettingsSaveState(text) {
    setText(els.saveSettingsText, state.savingSettings ? text.loading : text.save);
    els.saveSettingsBtn.disabled = state.savingSettings;
    setText(els.settingsError, state.errors.settings);
    els.settingsError.hidden = !state.errors.settings;
  }

  function syncSettingsControls(locale) {
    els.autoUpdateSwitch.checked = Boolean(state.settingsDraft.autoUpdateEnabled);
    els.autoStartSwitch.checked = Boolean(state.settingsDraft.autoStartEnabled);
    els.hideDockIconSwitch.checked = Boolean(state.settingsDraft.hideDockIcon);
    els.hideDockIconRow.hidden = !isMacOS;
    els.hideDockIconSwitch.disabled = !isMacOS;
    renderSelectOptionGroups(locale);
    els.localeSelect.value = state.settingsDraft.locale === "en" ? "en" : "zh";
    customSelects.sync();
  }

  function handleCustomSelectChange(selectId, value) {
    customSelectHandlers[selectId]?.(value);
  }

  function syncAutoUpdateDraft() {
    state.settingsDraft.autoUpdateEnabled = els.autoUpdateSwitch.checked;
    render();
  }

  function syncAutoStartDraft() {
    state.settingsDraft.autoStartEnabled = els.autoStartSwitch.checked;
    render();
  }

  function syncHideDockIconDraft() {
    state.settingsDraft.hideDockIcon = els.hideDockIconSwitch.checked;
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

  function selectLogLevel(logLevel) {
    state.settingsDraft.logLevel = normalizeLogLevel(logLevel);
    render();
  }

  function selectMeterWindow(meterWindow) {
    state.settingsDraft.meterWindow = normalizeMeterWindow(meterWindow);
    render();
  }

  function selectDataBar(index, content) {
    const normalized = normalizeDataBarContent(content);
    if (!normalized) return;
    // 首次修改时固化当前套餐布局，之后只按用户明确选择保存。
    const dataBars = resolveDataBars(state.settingsDraft.dataBars, state.quota?.planType);
    dataBars[index] = normalized;
    state.settingsDraft.dataBars = dataBars;
    render();
  }

  async function chooseCodexPath() {
    if (lifecycle.destroyed || !service.isAvailable()) return;

    try {
      const selected = await service.dialog.chooseCodexPath();
      if (lifecycle.destroyed) return;
      if (typeof selected === "string") {
        els.codexPathInput.value = selected;
        state.settingsDraft.codexCliPath = selected;
      }
    } catch (error) {
      logger.error("选择 Codex CLI 路径失败", error, "frontend.settings");
      state.errors.settings = normalizeError(error);
      render();
    }
  }

  async function saveSettings() {
    if (lifecycle.destroyed || state.savingSettings) return;

    state.savingSettings = true;
    render();

    try {
      const draftSettings = collectSettingsDraft();
      const currentPosition = await readCurrentWindowPosition();
      await persistSettings((currentSettings) => mergeWindowPosition({
        ...currentSettings,
        ...draftSettings,
        // 位置字段只由本次读取结果覆盖，保留队列中刚写入的另一种窗口位置。
        panelPosition: currentSettings.panelPosition,
        ballPosition: currentSettings.ballPosition,
        ballDock: currentSettings.ballDock
      }, currentPosition), { syncDraft: false });
      if (lifecycle.destroyed) return;
      state.settingsOpen = false;
      state.errors.settings = "";
      setUpdateStatus({ type: "saved" });
      scheduleAutoRefresh();
      refreshQuota();
      scheduleUpdateChecks();
      focusManager.deactivate();
    } catch (error) {
      logger.error("保存设置失败", error, "frontend.settings");
      state.errors.settings = normalizeError(error);
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
      meterWindow: normalizeMeterWindow(els.meterWindowSelect.value),
      dataBars: normalizeDataBars(state.settingsDraft.dataBars),
      logLevel: normalizeLogLevel(els.logLevelSelect.value),
      autoUpdateEnabled: els.autoUpdateSwitch.checked,
      autoStartEnabled: els.autoStartSwitch.checked,
      hideDockIcon: els.hideDockIconSwitch.checked,
      onboardingSeen: state.settings.onboardingSeen,
      widgetMode: state.widgetMode,
      panelPosition: state.settings.panelPosition,
      ballPosition: state.settings.ballPosition,
      ballDock: state.settings.ballDock
    };
  }

  function renderSelectOptionGroups(locale) {
    selectOptionConfigs.forEach(({ select, registry, currentValue }) => {
      renderSelectOptions(select, registry, currentValue(), locale);
    });
  }

  function renderSelectOptions(select, registry, currentValue, locale) {
    const items = Object.entries(registry).map(([value, item]) => ({
      value,
      label: item.label[locale] || item.label.zh
    }));
    const signature = items.map((item) => `${item.value}:${item.label}`).join("|");

    if (selectOptionSignatures.get(select) !== signature) {
      const options = items.map((item) => {
        const option = document.createElement("option");
        option.value = item.value;
        option.textContent = item.label;
        return option;
      });
      select.replaceChildren(...options);
      selectOptionSignatures.set(select, signature);
    }

    select.value = currentValue;
  }

  function destroy() {
    if (lifecycle.destroyed) return;
    lifecycle.destroy();
    customSelects.destroy();
    focusManager.destroy();
    els.settingsPanel.hidden = true;
  }

  return {
    destroy,
    bindEvents,
    closeSettingsPanel,
    openSettingsPanel,
    renderSettingsPanel
  };
}
