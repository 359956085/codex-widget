// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app/app.js";
import { createElements } from "../src/app/dom.js";
import { createAppState } from "../src/app/state.js";
import { loadApplicationMarkup } from "./dom-test-utils.js";

const applications = [];
afterEach(() => applications.splice(0).forEach((app) => app.destroy()));

describe("应用编排", () => {
  it("创建中途失败也释放此前创建的资源", () => {
    loadApplicationMarkup();
    const destroy = vi.fn();
    expect(() => createApp({
      els: createElements(),
      state: createAppState(),
      service: { isAvailable: () => false },
      factories: {
        createTooltipController: () => ({ destroy }),
        createWindowController: () => { throw new Error("创建窗口控制器失败"); }
      }
    })).toThrow("创建窗口控制器失败");
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("真实控制器销毁后取消计时任务并移除提示节点", async () => {
    vi.useFakeTimers();
    loadApplicationMarkup();
    const state = createAppState();
    const service = {
      isAvailable: () => true,
      commands: {
        getSettings: vi.fn(async () => ({ ...state.settings, onboardingSeen: true, autoUpdateEnabled: false })),
        getAlwaysOnTop: vi.fn(async () => true),
        getQuota: vi.fn(async () => ({ resetCredits: { expiries: [] } })),
        setAlwaysOnTop: vi.fn()
      },
      events: { listen: vi.fn(async () => vi.fn()) },
      window: {
        setSize: vi.fn(async () => {}),
        outerSize: vi.fn(async () => ({ width: 390, height: 236 })),
        currentMonitor: vi.fn(async () => ({ workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } } })),
        setPosition: vi.fn(async () => {}),
        onMoved: vi.fn(async () => vi.fn())
      }
    };
    const app = createApp({ state, service, logger: { error: vi.fn() } });
    applications.push(app);
    try {
      await app.start();
      expect(document.querySelector(".app-tooltip")).not.toBeNull();
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      app.destroy();
      expect(document.querySelector(".app-tooltip")).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
      document.getElementById("pinBtn").click();
      await vi.advanceTimersByTimeAsync(600_000);
      expect(service.commands.setAlwaysOnTop).not.toHaveBeenCalled();
      expect(service.commands.getQuota).toHaveBeenCalledOnce();
    } finally {
      app.destroy();
      vi.useRealTimers();
    }
  });
  it("重复启动复用同一任务，销毁解除运行时与按钮监听", async () => {
    const fixture = createFixture();
    const unlisten = vi.fn();
    fixture.service.events.listen.mockResolvedValue(unlisten);
    const first = fixture.app.start();
    expect(fixture.app.start()).toBe(first);
    await first;
    fixture.app.destroy();
    fixture.app.destroy();
    fixture.els.pinBtn.click();
    expect(fixture.service.commands.setAlwaysOnTop).not.toHaveBeenCalled();
    expect(fixture.controllers.window.bindEvents).toHaveBeenCalledOnce();
    Object.values(fixture.controllers).forEach((controller) => expect(controller.destroy).toHaveBeenCalledOnce());
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("启动失败清理已创建的控制器", async () => {
    const fixture = createFixture();
    fixture.controllers.window.applyWidgetModeWindow.mockRejectedValue(new Error("窗口初始化失败"));
    await expect(fixture.app.start()).rejects.toThrow("窗口初始化失败");
    Object.values(fixture.controllers).forEach((controller) => expect(controller.destroy).toHaveBeenCalledOnce());
    expect(fixture.controllers.quota.refreshQuota).not.toHaveBeenCalled();
  });

  it("启动途中销毁后不继续创建后台任务", async () => {
    const fixture = createFixture();
    let resolve;
    fixture.service.commands.getSettings.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const started = fixture.app.start();
    await Promise.resolve();
    fixture.app.destroy();
    resolve({ ...fixture.state.settings, theme: "basic3" });
    await started;
    expect(fixture.state.settings.theme).toBe("default");
    expect(fixture.controllers.window.applyWidgetModeWindow).not.toHaveBeenCalled();
    expect(fixture.controllers.quota.refreshQuota).not.toHaveBeenCalled();
  });

  it("运行时监听迟到时立即解除，不恢复已销毁界面", async () => {
    const fixture = createFixture();
    let resolve;
    const unlisten = vi.fn();
    const registration = new Promise((done) => { resolve = done; });
    fixture.service.events.listen.mockReturnValue(registration);
    const started = fixture.app.start();
    await vi.waitFor(() => expect(fixture.service.events.listen).toHaveBeenCalledTimes(2));
    fixture.app.destroy();
    const before = fixture.render.mock.calls.length;
    resolve(unlisten);
    await started;
    fixture.service.events.listen.mock.calls[1][1]({ payload: false });
    expect(fixture.state.alwaysOnTop).toBe(true);
    expect(fixture.render).toHaveBeenCalledTimes(before);
    expect(unlisten).toHaveBeenCalledTimes(2);
  });
  it("损坏设置安全回退，监听失败不阻断核心任务", async () => {
    const fixture = createFixture({ settingsError: new Error("settings.json 已损坏") });

    await fixture.app.start();

    expect(fixture.state.settings.theme).toBe("default");
    expect(fixture.state.errors.settings).toBe("settings.json 已损坏");
    expect(fixture.controllers.window.applyWidgetModeWindow).toHaveBeenCalledOnce();
    expect(fixture.controllers.window.registerWindowMoveSave).toHaveBeenCalledOnce();
    expect(fixture.controllers.quota.refreshQuota).toHaveBeenCalledOnce();
    expect(fixture.controllers.quota.scheduleAutoRefresh).toHaveBeenCalledOnce();
    expect(fixture.controllers.update.scheduleUpdateChecks).toHaveBeenCalledOnce();
    expect(fixture.service.events.listen).toHaveBeenCalledTimes(2);
    expect(fixture.logger.error).toHaveBeenCalledWith(
      "监听托盘刷新事件失败",
      expect.any(Error),
      "frontend.events"
    );
  });

  it("置顶失败只写窗口错误域", async () => {
    const fixture = createFixture({ alwaysOnTopError: new Error("置顶失败") });
    await fixture.app.start();

    fixture.els.pinBtn.click();
    await vi.waitFor(() => expect(fixture.state.errors.window).toBe("置顶失败"));

    expect(fixture.state.errors.settings).toBe("");
    expect(fixture.state.errors.quota).toBe("");
  });
});

function createFixture({ settingsError, alwaysOnTopError } = {}) {
  loadApplicationMarkup();
  const els = createElements();
  const state = createAppState();
  const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const getSettings = settingsError
    ? vi.fn().mockRejectedValue(settingsError)
    : vi.fn().mockResolvedValue({ ...state.settings, onboardingSeen: true });
  const setAlwaysOnTop = alwaysOnTopError
    ? vi.fn().mockRejectedValue(alwaysOnTopError)
    : vi.fn().mockResolvedValue(true);
  const service = {
    isAvailable: () => true,
    commands: {
      getSettings,
      getAlwaysOnTop: vi.fn().mockResolvedValue(true),
      setAlwaysOnTop
    },
    events: {
      listen: vi.fn(async (eventName) => {
        if (eventName === "quota:refresh-requested") throw new Error("监听失败");
        return () => {};
      })
    }
  };
  const controllers = {
    window: {
      bindEvents: vi.fn(),
      applyWidgetModeWindow: vi.fn().mockResolvedValue(undefined),
      registerWindowMoveSave: vi.fn().mockResolvedValue(undefined),
      readCurrentWindowPosition: vi.fn(),
      mergeWindowPosition: vi.fn(),
      clearPanelClick: vi.fn()
    },
    quota: {
      refreshQuota: vi.fn().mockResolvedValue(undefined),
      scheduleAutoRefresh: vi.fn()
    },
    update: {
      scheduleUpdateChecks: vi.fn(),
      setUpdateStatus: vi.fn(),
      checkForUpdates: vi.fn()
    },
    onboarding: {
      bindEvents: vi.fn(),
      runInitialOnboarding: vi.fn().mockResolvedValue(undefined)
    },
    settings: {
      bindEvents: vi.fn(),
      renderSettingsPanel: vi.fn()
    }
  };
  const render = vi.fn();
  Object.values(controllers).forEach((controller) => { controller.destroy = vi.fn(); });
  const factories = {
    createSettingsPersistence: () => ({ persistSettings: vi.fn() }),
    createTooltipController: () => ({ bindEvents: vi.fn() }),
    createWindowController: () => controllers.window,
    createQuotaController: () => controllers.quota,
    createUpdateController: () => controllers.update,
    createOnboardingController: () => controllers.onboarding,
    createSettingsController: () => controllers.settings,
    createRenderer: () => ({ render })
  };
  const app = createApp({
    els,
    state,
    service,
    logger,
    factories,
    initializeActionIcons: vi.fn()
  });
  applications.push(app);
  return { app, controllers, els, logger, service, state, render };
}
