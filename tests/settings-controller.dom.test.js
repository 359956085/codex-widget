// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { i18n } from "../src/app/constants.js";
import { createElements } from "../src/app/dom.js";
import { createSettingsController } from "../src/app/settings-controller.js";
import { createAppState } from "../src/app/state.js";
import { loadApplicationMarkup } from "./dom-test-utils.js";

describe("设置面板", () => {
  it("保存成功后关闭面板并启动最新调度", async () => {
    const fixture = createFixture(vi.fn().mockResolvedValue({}));
    fixture.open();
    fixture.els.saveSettingsBtn.click();

    await vi.waitFor(() => expect(fixture.persistSettings).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(fixture.state.savingSettings).toBe(false));
    expect(fixture.state.settingsOpen).toBe(false);
    expect(fixture.state.errors.settings).toBe("");
    expect(fixture.scheduleAutoRefresh).toHaveBeenCalledOnce();
    expect(fixture.refreshQuota).toHaveBeenCalledOnce();
    expect(fixture.scheduleUpdateChecks).toHaveBeenCalledOnce();
  });

  it("保存失败时留在面板并通过 aria-live 展示错误", async () => {
    const fixture = createFixture(vi.fn().mockRejectedValue(new Error("磁盘写入失败")));
    fixture.open();
    fixture.els.saveSettingsBtn.click();

    await vi.waitFor(() => expect(fixture.state.savingSettings).toBe(false));
    expect(fixture.state.settingsOpen).toBe(true);
    expect(fixture.state.errors.settings).toBe("磁盘写入失败");
    expect(fixture.els.settingsError.hidden).toBe(false);
    expect(fixture.els.settingsError.textContent).toBe("磁盘写入失败");
    expect(fixture.els.settingsError.getAttribute("aria-live")).toBe("assertive");
  });

  it("隐藏仪表窗口后仍保留旧配置值", async () => {
    const fixture = createFixture(vi.fn().mockResolvedValue({}));
    fixture.state.settings.meterWindow = "primary";
    fixture.open();

    expect(fixture.els.meterWindowSelect.value).toBe("primary");
    expect(fixture.els.meterWindowSelect.closest(".settings-field").hidden).toBe(true);

    fixture.els.saveSettingsBtn.click();
    await vi.waitFor(() => expect(fixture.persistSettings).toHaveBeenCalledOnce());

    const [updateSettings] = fixture.persistSettings.mock.calls[0];
    const savedSettings = updateSettings({
      ...fixture.state.settings,
      meterWindow: "secondary"
    });
    expect(savedSettings.meterWindow).toBe("primary");
  });

  it("Escape 关闭面板并恢复打开按钮焦点", () => {
    const fixture = createFixture(vi.fn().mockResolvedValue({}));
    fixture.open();
    expect(document.activeElement).toBe(fixture.els.settingsCloseBtn);

    fixture.els.settingsCloseBtn.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true
    }));

    expect(fixture.state.settingsOpen).toBe(false);
    expect(document.activeElement).toBe(fixture.els.settingsBtn);
  });
});

function createFixture(persistSettings) {
  loadApplicationMarkup();
  const els = createElements();
  const state = createAppState();
  const scheduleAutoRefresh = vi.fn();
  const refreshQuota = vi.fn();
  const scheduleUpdateChecks = vi.fn();
  let controller;
  const render = vi.fn(() => controller.renderSettingsPanel(i18n.zh));
  controller = createSettingsController({
    els,
    state,
    service: {
      isAvailable: () => true,
      dialog: { chooseCodexPath: vi.fn() }
    },
    render,
    renderLocale: () => "zh",
    persistSettings,
    normalizeError: (error) => error.message,
    readCurrentWindowPosition: vi.fn().mockResolvedValue(null),
    mergeWindowPosition: (settings) => settings,
    setUpdateStatus: vi.fn(),
    scheduleAutoRefresh,
    refreshQuota,
    scheduleUpdateChecks,
    logger: { error: vi.fn() },
    clearPanelClick: vi.fn()
  });
  controller.bindEvents();

  return {
    controller,
    els,
    state,
    persistSettings,
    scheduleAutoRefresh,
    refreshQuota,
    scheduleUpdateChecks,
    open() {
      els.settingsBtn.focus();
      els.settingsBtn.click();
    }
  };
}
