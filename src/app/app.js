import { DEFAULT_SETTINGS, i18n } from "./constants.js";
import { createElements } from "./dom.js";
import { initializeActionIcons } from "./icons.js";
import { createLogger } from "./logger.js";
import { createOnboardingController } from "./onboarding-controller.js";
import { createQuotaController } from "./quota-controller.js";
import { createRenderer } from "./render.js";
import { createSettingsController } from "./settings-controller.js";
import { createSettingsPersistence } from "./settings-persistence.js";
import { listenRuntimeEvent } from "./startup.js";
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

  const { persistSettings } = createSettingsPersistence({
    state,
    service,
    applyNormalizedSettings,
    render: () => render()
  });

  async function saveCurrentSettings({ silent = false } = {}) {
    if (!service.isAvailable()) return;

    try {
      await persistSettings((currentSettings) => currentSettings);
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
    persistSettings,
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

  const onboardingController = createOnboardingController({
    els,
    state,
    renderLocale: () => renderLocale(state),
    renderTheme: () => renderTheme(state),
    applyNormalizedSettings,
    saveCurrentSettings,
    i18n
  });

  const settingsController = createSettingsController({
    els,
    state,
    service,
    render: () => render(),
    renderLocale: () => renderLocale(state),
    persistSettings,
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
    onboardingController.bindEvents();
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
    await onboardingController.runInitialOnboarding();
    await windowController.registerWindowMoveSave();

    try {
      state.alwaysOnTop = await service.commands.getAlwaysOnTop();
    } catch (error) {
      logger.error("读取窗口置顶状态失败", error, "frontend.window");
      state.alwaysOnTop = true;
      showError(error);
    }

    const runtimeEventRegistrations = [
      listenRuntimeEvent(
        service.events.listen,
        "quota:refresh-requested",
        () => quotaController.refreshQuota(),
        (error) => logger.error("监听托盘刷新事件失败", error, "frontend.events")
      ),
      listenRuntimeEvent(
        service.events.listen,
        "window:always-on-top-changed",
        (event) => {
          state.alwaysOnTop = Boolean(event.payload);
          render();
        },
        (error) => logger.error("监听窗口置顶事件失败", error, "frontend.events")
      )
    ];

    // 事件监听属于增强能力，不能阻塞核心刷新与定时任务启动。
    void quotaController.refreshQuota();
    quotaController.scheduleAutoRefresh();
    updateController.scheduleUpdateChecks();
    await Promise.all(runtimeEventRegistrations);
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
