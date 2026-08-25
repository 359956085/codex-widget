// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createElements } from "../src/app/dom.js";
import { initializeActionIcons } from "../src/app/icons.js";
import { createRenderer } from "../src/app/render.js";
import { createAppState } from "../src/app/state.js";
import { createTooltipController } from "../src/app/tooltip-controller.js";
import { loadApplicationMarkup } from "./dom-test-utils.js";

describe("界面渲染", () => {
  let els;
  let state;
  let renderer;

  beforeEach(() => {
    loadApplicationMarkup();
    els = createElements();
    initializeActionIcons(els);
    state = createAppState();
    renderer = createRenderer({
      els,
      state,
      getLocale: () => "zh",
      getTheme: () => state.settings.theme,
      onVersionClick: vi.fn(),
      settingsView: { renderSettingsPanel: vi.fn() }
    });
  });

  it("按设置、窗口、额度顺序展示错误", () => {
    state.errors.settings = "设置错误";
    state.errors.window = "窗口错误";
    state.errors.quota = "额度错误";
    renderer.render();
    expect(els.statusText.textContent).toBe("设置错误");

    state.errors.settings = "";
    renderer.render();
    expect(els.statusText.textContent).toBe("窗口错误");

    state.errors.window = "";
    renderer.render();
    expect(els.statusText.textContent).toBe("额度错误");
  });

  it("只在悬浮球模式提供按钮语义和键盘焦点", () => {
    state.widgetMode = "ball";
    renderer.render();
    expect(els.widget.getAttribute("role")).toBe("button");
    expect(els.widget.tabIndex).toBe(0);

    state.widgetMode = "panel";
    renderer.render();
    expect(els.widget.hasAttribute("role")).toBe(false);
    expect(els.widget.hasAttribute("tabindex")).toBe(false);
  });

  it("面板和悬浮球固定展示周额度并忽略旧设置", () => {
    state.quota = createQuotaFixture();
    state.settings.meterWindow = "primary";
    state.settingsDraft.meterWindow = "primary";

    renderer.render();
    expect(els.meterHost.textContent).toContain("97%");

    state.settingsOpen = true;
    renderer.render();
    expect(els.meterHost.textContent).toContain("97%");

    state.widgetMode = "ball";
    renderer.render();
    expect(els.meterHost.textContent).toContain("97%");
  });

  it("周额度缺失时不回退五小时额度", () => {
    state.quota = {
      primary: { remainingPercent: 88, windowDurationMins: 300 },
      secondary: null
    };

    renderer.render();

    expect(els.meterHost.textContent).toContain("--%");
    expect(document.body.dataset.state).toBe("unknown");
  });

  it("隐藏仪表窗口设置并移出焦点顺序", () => {
    const field = els.meterWindowSelect.closest(".settings-field");

    expect(field.hidden).toBe(true);
    expect(field.matches("[hidden]")).toBe(true);
  });

  it("按稳定状态展示上周和本周额度估算", () => {
    state.quota = createQuotaFixture();
    renderer.render();

    expect(els.estimateLabel.textContent).toBe("额度估算");
    expect(els.previousEstimateValue.textContent).toBe("$105");
    expect(els.currentEstimateValue.textContent).toBe("--");
    expect(els.quotaEstimateCard.dataset.tooltip).toContain("样本或跨度不足");
    expect(els.quotaEstimateCard.dataset.tooltip).not.toContain("R²");
    expect(els.quotaEstimateCard.getAttribute("aria-label")).toContain("不等于实际账单");
    expect(els.secondaryText.textContent).toBe("97%");
  });

  it("四套主题都能挂载并更新估算卡", () => {
    state.quota = createQuotaFixture();
    for (const theme of ["default", "basic1", "basic2", "basic3"]) {
      state.settings.theme = theme;
      renderer.render();
      expect(document.body.dataset.theme).toBe(theme);
      expect(els.quotaEstimateCard.isConnected).toBe(true);
      expect(els.quotaEstimateCard.querySelector('[data-lucide="wallet-cards"]')).not.toBeNull();
      expect(els.previousEstimateValue.textContent).toBe("$105");
      expect(els.meterHost.childElementCount).toBeGreaterThan(0);
    }
  });

  it("额度估算卡支持键盘焦点并显示受限宽度提示", () => {
    vi.useFakeTimers();
    try {
      state.quota = createQuotaFixture();
      renderer.render();
      createTooltipController({ root: document.body }).bindEvents();

      els.quotaEstimateCard.focus();
      vi.advanceTimersByTime(1_000);

      const tooltip = document.querySelector(".app-tooltip");
      expect(document.activeElement).toBe(els.quotaEstimateCard);
      expect(tooltip.dataset.visible).toBe("true");
      expect(tooltip.dataset.placement).toBe("estimate");
      expect(tooltip.textContent).toContain("价格表 2026-08-25");
    } finally {
      vi.useRealTimers();
    }
  });
});

function createQuotaFixture() {
  return {
    primary: { remainingPercent: 88, windowDurationMins: 300 },
    secondary: { remainingPercent: 97, windowDurationMins: 10080, resetsAt: "2026-08-31T00:38:00Z" },
    resetCredits: { availableCount: 1 },
    quotaEstimate: {
      priceTableAsOf: "2026-08-25",
      previous: {
        status: "ready",
        fullQuotaUsd: 104.6,
        sampleCount: 39,
        percentSpan: 40,
        unpricedEventCount: 3
      },
      current: {
        status: "collecting",
        fullQuotaUsd: null,
        sampleCount: 10,
        percentSpan: 10,
        unpricedEventCount: 70
      }
    }
  };
}
