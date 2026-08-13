// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app/app.js";
import { createElements } from "../src/app/dom.js";
import { createAppState } from "../src/app/state.js";
import { loadApplicationMarkup } from "./dom-test-utils.js";

describe("应用编排", () => {
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
  return { app, controllers, els, logger, service, state };
}
