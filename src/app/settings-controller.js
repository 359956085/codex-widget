import { DEFAULT_SETTINGS, LOG_LEVELS, METER_WINDOWS, THEMES } from "./constants.js";
import { createCustomSelectController } from "./custom-select.js";
import { syncSettingsDraftFromSettings } from "./state.js";
import { normalizeInputValue, normalizeLogLevel, normalizeMeterWindow, normalizeTheme } from "./settings-model.js";

export function createSettingsController({
  els,
  state,
  service,
  render,
  renderLocale,
  applySettings,
  normalizeError,
  readCurrentWindowPosition,
  mergeWindowPosition,
  setUpdateStatus,
  scheduleAutoRefresh,
  refreshQuota,
  scheduleUpdateChecks,
  logger,
  clearPanelClick
}) {
  const customSelects = createCustomSelectController({
    shells: els.customSelectShells,
    onChange: handleCustomSelectChange
  });

  function bindEvents() {
    els.settingsBtn.addEventListener("click", openSettingsPanel);
    els.settingsCloseBtn.addEventListener("click", closeSettingsPanel);
    els.cancelSettingsBtn.addEventListener("click", closeSettingsPanel);
    els.saveSettingsBtn.addEventListener("click", saveSettings);
    els.chooseCodexBtn.addEventListener("click", chooseCodexPath);
    els.autoUpdateSwitch.addEventListener("change", syncAutoUpdateDraft);
    els.autoStartSwitch.addEventListener("change", syncAutoStartDraft);
    customSelects.bindEvents();
  }

  function openSettingsPanel() {
    clearPanelClick();
    syncSettingsDraftFromSettings(state);
    state.settingsOpen = true;
    fillSettingsForm();
    render();
  }

  function closeSettingsPanel() {
    state.settingsOpen = false;
    syncSettingsDraftFromSettings(state);
    customSelects.close();
    render();
  }

  function fillSettingsForm() {
    els.codexPathInput.value = state.settingsDraft.codexCliPath || "";
    els.updateProxyInput.value = state.settingsDraft.updateProxy || "";
    els.refreshIntervalInput.value = String(state.settingsDraft.refreshIntervalMinutes || DEFAULT_SETTINGS.refreshIntervalMinutes);
    els.autoUpdateSwitch.checked = Boolean(state.settingsDraft.autoUpdateEnabled);
    els.autoStartSwitch.checked = Boolean(state.settingsDraft.autoStartEnabled);
    renderThemeOptions(renderLocale());
    renderMeterWindowOptions(renderLocale());
    els.themeSelect.value = normalizeTheme(state.settingsDraft.theme);
    els.localeSelect.value = state.settingsDraft.locale === "en" ? "en" : "zh";
    els.meterWindowSelect.value = normalizeMeterWindow(state.settingsDraft.meterWindow);
    els.logLevelSelect.value = normalizeLogLevel(state.settingsDraft.logLevel);
    customSelects.sync();
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
    els.meterWindowLabel.textContent = text.meterWindow;
    els.logLevelLabel.textContent = text.logLevel;
    els.codexPathInput.placeholder = text.codexPathPlaceholder;
    els.updateProxyInput.placeholder = text.updateProxyPlaceholder;
    els.cancelSettingsBtn.textContent = text.cancel;
    els.saveSettingsText.textContent = state.savingSettings ? text.loading : text.save;
    els.saveSettingsBtn.disabled = state.savingSettings;
    els.autoUpdateSwitch.checked = Boolean(state.settingsDraft.autoUpdateEnabled);
    els.autoStartSwitch.checked = Boolean(state.settingsDraft.autoStartEnabled);
    renderThemeOptions(renderLocale());
    renderMeterWindowOptions(renderLocale());
    renderLogLevelOptions(renderLocale());
    els.themeSelect.value = normalizeTheme(state.settingsDraft.theme);
    els.localeSelect.value = state.settingsDraft.locale === "en" ? "en" : "zh";
    els.meterWindowSelect.value = normalizeMeterWindow(state.settingsDraft.meterWindow);
    els.logLevelSelect.value = normalizeLogLevel(state.settingsDraft.logLevel);
    customSelects.sync();
  }

  function handleCustomSelectChange(selectId, value) {
    if (selectId === "themeSelect") {
      selectSettingsTheme(value);
    } else if (selectId === "localeSelect") {
      selectSettingsLocale(value);
    } else if (selectId === "meterWindowSelect") {
      selectMeterWindow(value);
    } else if (selectId === "logLevelSelect") {
      selectLogLevel(value);
    }
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

  function selectLogLevel(logLevel) {
    state.settingsDraft.logLevel = normalizeLogLevel(logLevel);
    render();
  }

  function selectMeterWindow(meterWindow) {
    state.settingsDraft.meterWindow = normalizeMeterWindow(meterWindow);
    render();
  }

  async function chooseCodexPath() {
    if (!service.isAvailable()) return;

    try {
      const selected = await service.dialog.chooseCodexPath();
      if (typeof selected === "string") {
        els.codexPathInput.value = selected;
        state.settingsDraft.codexCliPath = selected;
      }
    } catch (error) {
      logger.error("选择 Codex CLI 路径失败", error, "frontend.settings");
      state.error = normalizeError(error);
      render();
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
      const saved = service.isAvailable() ? await service.commands.saveSettings(nextSettings) : nextSettings;
      applySettings(saved);
      state.settingsOpen = false;
      state.error = "";
      setUpdateStatus({ type: "saved" });
      scheduleAutoRefresh();
      refreshQuota();
      scheduleUpdateChecks();
    } catch (error) {
      logger.error("保存设置失败", error, "frontend.settings");
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
      meterWindow: normalizeMeterWindow(els.meterWindowSelect.value),
      logLevel: normalizeLogLevel(els.logLevelSelect.value),
      autoUpdateEnabled: els.autoUpdateSwitch.checked,
      autoStartEnabled: els.autoStartSwitch.checked,
      widgetMode: state.widgetMode,
      panelPosition: state.settings.panelPosition,
      ballPosition: state.settings.ballPosition,
      ballDock: state.settings.ballDock
    };
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

  function renderMeterWindowOptions(locale) {
    const currentMeterWindow = normalizeMeterWindow(state.settingsDraft.meterWindow);
    const options = Object.entries(METER_WINDOWS).map(([value, meterWindow]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = meterWindow.label[locale] || meterWindow.label.zh;
      return option;
    });
    els.meterWindowSelect.replaceChildren(...options);
    els.meterWindowSelect.value = currentMeterWindow;
  }

  function renderLogLevelOptions(locale) {
    const currentLogLevel = normalizeLogLevel(state.settingsDraft.logLevel);
    const options = Object.entries(LOG_LEVELS).map(([value, logLevel]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = logLevel.label[locale] || logLevel.label.zh;
      return option;
    });
    els.logLevelSelect.replaceChildren(...options);
    els.logLevelSelect.value = currentLogLevel;
  }

  return {
    bindEvents,
    closeSettingsPanel,
    openSettingsPanel,
    renderSettingsPanel
  };
}
