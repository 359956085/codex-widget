import { normalizeError } from "./errors.js";
import { createLifecycle } from "./lifecycle.js";
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

export function createApp(dependencies = {}) {
  const lifecycle = createLifecycle();
  try {
    return initializeApp(dependencies, lifecycle);
  } catch (error) {
    lifecycle.destroy();
    throw error;
  }
}

function initializeApp(dependencies, lifecycle) {
  const els = dependencies.els || createElements();
  const state = dependencies.state || createAppState();
  const service = dependencies.service || createTauriService();
  const logger = dependencies.logger || createLogger(service);
  const factories = dependencies.factories || {};
  const initializeIcons = dependencies.initializeActionIcons || initializeActionIcons;
  const tooltipController = (factories.createTooltipController || createTooltipController)({ root: els.body });
  lifecycle.add(() => tooltipController.destroy?.());
  let render = () => {};

  function applySettings(settings) {
    applyNormalizedSettings(settings);
    render();
  }

  function applyNormalizedSettings(settings, options) {
    return applyStateSettings(state, settings, options);
  }

  const { persistSettings } = (factories.createSettingsPersistence || createSettingsPersistence)({
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
        showSettingsError(error);
      }
    }
  }

  function showSettingsError(error) {
    state.errors.settings = normalizeError(error);
    render();
  }

  function showWindowError(error) {
    state.errors.window = normalizeError(error);
    render();
  }

  const windowController = (factories.createWindowController || createWindowController)({
    els,
    state,
    service,
    render: () => render(),
    persistSettings,
    logger
  });
  lifecycle.add(() => windowController.destroy?.());

  const quotaController = (factories.createQuotaController || createQuotaController)({
    state,
    service,
    render: () => render(),
    normalizeError,
    logger
  });
  lifecycle.add(() => quotaController.destroy?.());

  const updateController = (factories.createUpdateController || createUpdateController)({
    state,
    service,
    render: () => render(),
    logger
  });
  lifecycle.add(() => updateController.destroy?.());

  const onboardingController = (factories.createOnboardingController || createOnboardingController)({
    els,
    state,
    renderLocale: () => renderLocale(state),
    renderTheme: () => renderTheme(state),
    applyNormalizedSettings,
    saveCurrentSettings,
    i18n
  });
  lifecycle.add(() => onboardingController.destroy?.());

  const settingsController = (factories.createSettingsController || createSettingsController)({
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
  lifecycle.add(() => settingsController.destroy?.());

  const renderer = (factories.createRenderer || createRenderer)({
    els,
    state,
    getLocale: () => renderLocale(state),
    getTheme: () => renderTheme(state),
    onVersionClick: triggerManualUpdateCheck,
    settingsView: settingsController
  });
  lifecycle.add(() => renderer.destroy?.());
  render = lifecycle.guard(renderer.render);
  let startPromise = null;

  function bindEvents() {
    if (!lifecycle.bind()) return;
    windowController.bindEvents();
    settingsController.bindEvents();
    onboardingController.bindEvents();
    tooltipController.bindEvents();
    lifecycle.listen(document, "contextmenu", (event) => event.preventDefault());
    lifecycle.listen(els.pinBtn, "click", toggleAlwaysOnTop);
    lifecycle.listen(els.refreshBtn, "click", () => quotaController.refreshQuota());
  }

  async function toggleAlwaysOnTop() {
    try {
      const nextValue = !state.alwaysOnTop;
      state.alwaysOnTop = await service.commands.setAlwaysOnTop(nextValue);
      state.errors.window = "";
      render();
    } catch (error) {
      logger.error("设置窗口置顶状态失败", error, "frontend.window");
      showWindowError(error);
    }
  }

  function start() {
    if (lifecycle.destroyed) return startPromise ?? Promise.resolve();
    if (!startPromise) {
      startPromise = Promise.resolve().then(async () => {
        if (lifecycle.destroyed) return;
        initializeIcons(els, logger);
        bindEvents();
        await initialize();
      }).catch((error) => {
        destroy();
        throw error;
      });
    }
    return startPromise;
  }

  function destroy() {
    lifecycle.destroy();
  }

  async function initialize() {
    render();
    await loadSettings();
    if (lifecycle.destroyed) return;
    await windowController.applyWidgetModeWindow();
    if (lifecycle.destroyed) return;
    await onboardingController.runInitialOnboarding();
    if (lifecycle.destroyed) return;
    await windowController.registerWindowMoveSave();
    if (lifecycle.destroyed) return;

    try {
      state.alwaysOnTop = await service.commands.getAlwaysOnTop();
    } catch (error) {
      logger.error("读取窗口置顶状态失败", error, "frontend.window");
      state.alwaysOnTop = true;
      showWindowError(error);
    }

    if (lifecycle.destroyed) return;
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
        lifecycle.guard((event) => {
          state.alwaysOnTop = Boolean(event.payload);
          render();
        }),
        (error) => logger.error("监听窗口置顶事件失败", error, "frontend.events")
      )
    ].map((registration) => registration.then(lifecycle.add));

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
      if (!lifecycle.destroyed) applySettings(settings);
    } catch (error) {
      logger.error("读取设置失败", error, "frontend.settings");
      applySettings(DEFAULT_SETTINGS);
      showSettingsError(error);
    }
  }

  function triggerManualUpdateCheck(event) {
    event.preventDefault();
    event.stopPropagation();
    updateController.checkForUpdates({ manual: true });
  }

  return { start, destroy };
}
