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

  it("恢复仪表窗口设置并保存旧配置值", async () => {
    const fixture = createFixture(vi.fn().mockResolvedValue({}));
    fixture.state.settings.meterWindow = "primary";
    fixture.open();

    expect(fixture.els.meterWindowSelect.value).toBe("primary");
    expect(fixture.els.meterWindowSelect.closest(".settings-field").hidden).toBe(false);
    expect(fixture.els.meterWindowSelect.tabIndex).toBe(-1);
    expect(fixture.els.meterWindowSelect.closest(".custom-select-shell").querySelector("button").tabIndex).toBe(0);

    fixture.els.saveSettingsBtn.click();
    await vi.waitFor(() => expect(fixture.persistSettings).toHaveBeenCalledOnce());

    const [updateSettings] = fixture.persistSettings.mock.calls[0];
    const savedSettings = updateSettings({
      ...fixture.state.settings,
      meterWindow: "secondary"
    });
    expect(savedSettings.meterWindow).toBe("primary");
  });

  it("自动数据栏按 Plus 套餐展示且保存其他设置仍保持自动", async () => {
    const fixture = createFixture(vi.fn().mockResolvedValue({}));
    fixture.state.quota = { planType: "plus" };
    fixture.open();

    expect(fixture.els.dataBarSelects.map((select) => select.value))
      .toEqual(["fiveHour", "weekly", "quotaEstimate"]);
    expect(fixture.els.dataBarLabels.map((label) => label.textContent))
      .toEqual(["数据栏 1", "数据栏 2", "数据栏 3"]);

    fixture.els.saveSettingsBtn.click();
    await vi.waitFor(() => expect(fixture.persistSettings).toHaveBeenCalledOnce());
    const [updateSettings] = fixture.persistSettings.mock.calls[0];
    expect(updateSettings(fixture.state.settings).dataBars).toBeNull();
  });

  it("修改任一数据栏后保存完整布局并允许重复", async () => {
    const fixture = createFixture(vi.fn().mockResolvedValue({}));
    fixture.state.quota = { planType: "plus" };
    fixture.open();

    fixture.els.dataBarSelects[0].value = "weekly";
    fixture.els.dataBarSelects[0].dispatchEvent(new Event("change", { bubbles: true }));

    expect(fixture.state.settingsDraft.dataBars).toEqual(["weekly", "weekly", "quotaEstimate"]);

    fixture.els.saveSettingsBtn.click();
    await vi.waitFor(() => expect(fixture.persistSettings).toHaveBeenCalledOnce());
    const [updateSettings] = fixture.persistSettings.mock.calls[0];
    expect(updateSettings(fixture.state.settings).dataBars).toEqual(["weekly", "weekly", "quotaEstimate"]);
  });

  it("取消设置会丢弃数据栏草稿", () => {
    const fixture = createFixture(vi.fn().mockResolvedValue({}));
    fixture.state.quota = { planType: "plus" };
    fixture.open();

    fixture.els.dataBarSelects[0].value = "resetCredits";
    fixture.els.dataBarSelects[0].dispatchEvent(new Event("change", { bubbles: true }));
    expect(fixture.state.settingsDraft.dataBars).toEqual(["resetCredits", "weekly", "quotaEstimate"]);

    fixture.els.cancelSettingsBtn.click();
    expect(fixture.state.settingsOpen).toBe(false);
    expect(fixture.state.settingsDraft.dataBars).toBeNull();
  });

  it("macOS 可预览并保存隐藏 Dock 图标设置", async () => {
    const fixture = createFixture(vi.fn().mockResolvedValue({}), { isMacOS: true });
    fixture.state.settings.hideDockIcon = true;
    fixture.open();

    expect(fixture.els.hideDockIconRow.hidden).toBe(false);
    expect(fixture.els.hideDockIconSwitch.disabled).toBe(false);
    expect(fixture.els.hideDockIconSwitch.checked).toBe(true);
    expect(fixture.els.hideDockIconLabel.textContent).toBe("隐藏 Dock 图标");

    fixture.els.hideDockIconSwitch.checked = false;
    fixture.els.hideDockIconSwitch.dispatchEvent(new Event("change", { bubbles: true }));
    expect(fixture.state.settingsDraft.hideDockIcon).toBe(false);

    fixture.els.hideDockIconSwitch.checked = true;
    fixture.els.hideDockIconSwitch.dispatchEvent(new Event("change", { bubbles: true }));
    expect(fixture.state.settingsDraft.hideDockIcon).toBe(true);

    fixture.els.saveSettingsBtn.click();
    await vi.waitFor(() => expect(fixture.persistSettings).toHaveBeenCalledOnce());
    const [updateSettings] = fixture.persistSettings.mock.calls[0];
    expect(updateSettings({ ...fixture.state.settings, hideDockIcon: false }).hideDockIcon).toBe(true);
  });

  it("取消设置会恢复隐藏 Dock 图标草稿", () => {
    const fixture = createFixture(vi.fn().mockResolvedValue({}), { isMacOS: true });
    fixture.state.settings.hideDockIcon = true;
    fixture.open();

    fixture.els.hideDockIconSwitch.checked = false;
    fixture.els.hideDockIconSwitch.dispatchEvent(new Event("change", { bubbles: true }));
    fixture.els.cancelSettingsBtn.click();

    expect(fixture.state.settingsDraft.hideDockIcon).toBe(true);
  });

  it("非 macOS 隐藏并禁用 Dock 设置", () => {
    const fixture = createFixture(vi.fn().mockResolvedValue({}), { isMacOS: false });
    fixture.open();

    expect(fixture.els.hideDockIconRow.hidden).toBe(true);
    expect(fixture.els.hideDockIconSwitch.disabled).toBe(true);
    fixture.els.hideDockIconSwitch.focus();
    expect(document.activeElement).not.toBe(fixture.els.hideDockIconSwitch);
  });

  it("英文设置展示数据栏和 Dock 文案", () => {
    const fixture = createFixture(vi.fn().mockResolvedValue({}), { locale: "en", isMacOS: true });
    fixture.state.settings.locale = "en";
    fixture.open();

    expect(fixture.els.dataBarLabels.map((label) => label.textContent))
      .toEqual(["Data bar 1", "Data bar 2", "Data bar 3"]);
    expect(Array.from(fixture.els.dataBarSelects[0].options, (option) => option.textContent))
      .toEqual(["5h window", "Weekly window", "Reset credits", "Quota estimate"]);
    expect(fixture.els.hideDockIconLabel.textContent).toBe("Hide Dock icon");
    expect(fixture.els.hideDockIconHint.textContent).toContain("macOS only");
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

function createFixture(persistSettings, { locale = "zh", isMacOS = false } = {}) {
  loadApplicationMarkup();
  const els = createElements();
  const state = createAppState();
  const scheduleAutoRefresh = vi.fn();
  const refreshQuota = vi.fn();
  const scheduleUpdateChecks = vi.fn();
  let controller;
  const render = vi.fn(() => controller.renderSettingsPanel(i18n[locale]));
  controller = createSettingsController({
    els,
    state,
    service: {
      isAvailable: () => true,
      dialog: { chooseCodexPath: vi.fn() }
    },
    render,
    renderLocale: () => locale,
    persistSettings,
    normalizeError: (error) => error.message,
    readCurrentWindowPosition: vi.fn().mockResolvedValue(null),
    mergeWindowPosition: (settings) => settings,
    setUpdateStatus: vi.fn(),
    scheduleAutoRefresh,
    refreshQuota,
    scheduleUpdateChecks,
    logger: { error: vi.fn() },
    clearPanelClick: vi.fn(),
    isMacOS
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
