import { DEFAULT_SETTINGS } from "./constants.js";
import { createElements } from "./dom.js";
import { initializeActionIcons } from "./icons.js";
import { createLogger } from "./logger.js";
import { createQuotaController } from "./quota-controller.js";
import { createRenderer } from "./render.js";
import { createSettingsController } from "./settings-controller.js";
import { applyNormalizedSettings as applyStateSettings, createAppState, renderLocale, renderTheme } from "./state.js";
import { createTauriService } from "./tauri-service.js";
import { createTooltipController } from "./tooltip-controller.js";
import { createUpdateController } from "./update-controller.js";
import { createWindowController } from "./window-controller.js";

export function createApp() {
  const els = createElements();
  const state = createAppState();
  const service = createTauriService();
  const logger = createLogger(service);
  const tooltipController = createTooltipController({ root: els.body });
  let render = () => {};

  function applySettings(settings) {
    applyNormalizedSettings(settings);
    render();
  }

  function applyNormalizedSettings(settings, options) {
    return applyStateSettings(state, settings, options);
  }

  async function saveCurrentSettings({ silent = false } = {}) {
    if (!service.isAvailable()) return;

    try {
      const saved = await service.commands.saveSettings(state.settings);
      applyNormalizedSettings(saved, { syncDraft: !state.settingsOpen });
      render();
    } catch (error) {
      if (silent) {
        logger.error("保存设置失败", error, "frontend.settings");
      } else {
        showError(error);
      }
    }
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

  const windowController = createWindowController({
    els,
    state,
    service,
    render: () => render(),
    applyNormalizedSettings,
    saveCurrentSettings,
    showError,
    logger
  });

  const quotaController = createQuotaController({
    state,
    service,
    render: () => render(),
    normalizeError,
    logger
  });

  const updateController = createUpdateController({
    state,
    service,
    render: () => render(),
    logger
  });

  const settingsController = createSettingsController({
    els,
    state,
    service,
    render: () => render(),
    renderLocale: () => renderLocale(state),
    applySettings,
    normalizeError,
    readCurrentWindowPosition: windowController.readCurrentWindowPosition,
    mergeWindowPosition: windowController.mergeWindowPosition,
    setUpdateStatus: updateController.setUpdateStatus,
    scheduleAutoRefresh: quotaController.scheduleAutoRefresh,
    refreshQuota: quotaController.refreshQuota,
    scheduleUpdateChecks: updateController.scheduleUpdateChecks,
    logger,
    clearPanelClick: windowController.clearPanelClick
  });

  const renderer = createRenderer({
    els,
    state,
    getLocale: () => renderLocale(state),
    getTheme: () => renderTheme(state),
    onVersionClick: triggerManualUpdateCheck,
    settingsView: settingsController
  });
  render = renderer.render;

  function bindEvents() {
    windowController.bindEvents();
    settingsController.bindEvents();
    tooltipController.bindEvents();
    els.pinBtn.addEventListener("click", toggleAlwaysOnTop);
    els.refreshBtn.addEventListener("click", () => quotaController.refreshQuota());
  }

  async function toggleAlwaysOnTop() {
    try {
      const nextValue = !state.alwaysOnTop;
      state.alwaysOnTop = await service.commands.setAlwaysOnTop(nextValue);
      render();
    } catch (error) {
      showError(error);
    }
  }

  async function start() {
    initializeActionIcons(els, logger);
    bindEvents();
    await initialize();
  }

  async function initialize() {
    render();
    await loadSettings();
    await windowController.applyWidgetModeWindow();
    await windowController.registerWindowMoveSave();

    try {
      state.alwaysOnTop = await service.commands.getAlwaysOnTop();
    } catch {
      state.alwaysOnTop = true;
    }

    await service.events.listen("quota:refresh-requested", () => quotaController.refreshQuota());
    await service.events.listen("window:always-on-top-changed", (event) => {
      state.alwaysOnTop = Boolean(event.payload);
      render();
    });

    quotaController.refreshQuota();
    quotaController.scheduleAutoRefresh();
    updateController.scheduleUpdateChecks();
  }

  async function loadSettings() {
    if (!service.isAvailable()) {
      applySettings(DEFAULT_SETTINGS);
      return;
    }

    try {
      const settings = await service.commands.getSettings();
      applySettings(settings);
    } catch (error) {
      logger.error("读取设置失败", error, "frontend.settings");
      applySettings(DEFAULT_SETTINGS);
    }
  }

  function triggerManualUpdateCheck(event) {
    event.preventDefault();
    event.stopPropagation();
    updateController.checkForUpdates({ manual: true });
  }

  return { start };
}
