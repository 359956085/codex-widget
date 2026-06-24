import { DEFAULT_SETTINGS, LOG_LEVELS, THEMES } from "./constants.js";
import { syncSettingsDraftFromSettings } from "./state.js";
import { normalizeInputValue, normalizeLogLevel, normalizeTheme } from "./settings-model.js";

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
  function bindEvents() {
    els.settingsBtn.addEventListener("click", openSettingsPanel);
    els.settingsCloseBtn.addEventListener("click", closeSettingsPanel);
    els.cancelSettingsBtn.addEventListener("click", closeSettingsPanel);
    els.saveSettingsBtn.addEventListener("click", saveSettings);
    els.chooseCodexBtn.addEventListener("click", chooseCodexPath);
    els.autoUpdateSwitch.addEventListener("change", syncAutoUpdateDraft);
    els.autoStartSwitch.addEventListener("change", syncAutoStartDraft);
    els.themeSelect.addEventListener("change", () => selectSettingsTheme(els.themeSelect.value));
    els.localeSelect.addEventListener("change", () => selectSettingsLocale(els.localeSelect.value));
    els.logLevelSelect.addEventListener("change", () => selectLogLevel(els.logLevelSelect.value));

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
    els.logLevelSelect.value = normalizeLogLevel(state.settingsDraft.logLevel);
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
    els.logLevelLabel.textContent = text.logLevel;
    els.codexPathInput.placeholder = text.codexPathPlaceholder;
    els.updateProxyInput.placeholder = text.updateProxyPlaceholder;
    els.cancelSettingsBtn.textContent = text.cancel;
    els.saveSettingsText.textContent = state.savingSettings ? text.loading : text.save;
    els.saveSettingsBtn.disabled = state.savingSettings;
    els.autoUpdateSwitch.checked = Boolean(state.settingsDraft.autoUpdateEnabled);
    els.autoStartSwitch.checked = Boolean(state.settingsDraft.autoStartEnabled);
    renderThemeOptions(renderLocale());
    renderLogLevelOptions(renderLocale());
    els.themeSelect.value = normalizeTheme(state.settingsDraft.theme);
    els.localeSelect.value = state.settingsDraft.locale === "en" ? "en" : "zh";
    els.logLevelSelect.value = normalizeLogLevel(state.settingsDraft.logLevel);
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

  function selectLogLevel(logLevel) {
    state.settingsDraft.logLevel = normalizeLogLevel(logLevel);
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
    closeCustomSelects,
    closeSettingsPanel,
    openSettingsPanel,
    renderSettingsPanel
  };
}
