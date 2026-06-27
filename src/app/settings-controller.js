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
  const selectOptionSignatures = new WeakMap();

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
    if (!state.settingsOpen) return;

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
    renderSelectOptions(els.themeSelect, THEMES, normalizeTheme(state.settingsDraft.theme), locale);
  }

  function renderMeterWindowOptions(locale) {
    renderSelectOptions(
      els.meterWindowSelect,
      METER_WINDOWS,
      normalizeMeterWindow(state.settingsDraft.meterWindow),
      locale
    );
  }

  function renderLogLevelOptions(locale) {
    renderSelectOptions(els.logLevelSelect, LOG_LEVELS, normalizeLogLevel(state.settingsDraft.logLevel), locale);
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

  return {
    bindEvents,
    closeSettingsPanel,
    openSettingsPanel,
    renderSettingsPanel
  };
}
