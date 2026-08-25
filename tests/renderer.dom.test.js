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

  it("面板和悬浮球按仪表设置展示额度并支持设置预览", () => {
    state.quota = createQuotaFixture();
    state.settings.meterWindow = "primary";
    state.settingsDraft.meterWindow = "primary";

    renderer.render();
    expect(els.meterHost.textContent).toContain("88%");

    state.settingsOpen = true;
    state.settingsDraft.meterWindow = "secondary";
    renderer.render();
    expect(els.meterHost.textContent).toContain("97%");

    state.settingsOpen = false;
    state.widgetMode = "ball";
    renderer.render();
    expect(els.meterHost.textContent).toContain("88%");
  });

  it("所选仪表窗口缺失时不回退另一窗口", () => {
    state.settings.meterWindow = "primary";
    state.quota = {
      primary: null,
      secondary: { remainingPercent: 97, windowDurationMins: 10080 }
    };

    renderer.render();

    expect(els.meterHost.textContent).toContain("--%");
    expect(document.body.dataset.state).toBe("unknown");
  });

  it("恢复仪表窗口设置", () => {
    const field = els.meterWindowSelect.closest(".settings-field");

    expect(field.hidden).toBe(false);
    expect(field.matches("[hidden]")).toBe(false);
  });

  it("按套餐生成自动数据栏布局", () => {
    state.quota = createQuotaFixture(" PLUS ");
    renderer.render();
    expect(dataBarOrder(els)).toEqual(["fiveHour", "weekly", "quotaEstimate"]);

    state.quota.planType = "pro";
    renderer.render();
    expect(dataBarOrder(els)).toEqual(["quotaEstimate", "weekly", "resetCredits"]);

    delete state.quota.planType;
    renderer.render();
    expect(dataBarOrder(els)).toEqual(["quotaEstimate", "weekly", "resetCredits"]);
  });

  it("用户布局覆盖套餐默认并允许重复数据栏", () => {
    state.quota = createQuotaFixture("plus");
    state.settings.dataBars = ["weekly", "weekly", "quotaEstimate"];

    renderer.render();
    expect(dataBarOrder(els)).toEqual(["weekly", "weekly", "quotaEstimate"]);
    expect(els.dataBarCards[0].querySelector("strong").textContent).toBe("97%");
    expect(els.dataBarCards[1].querySelector("strong").textContent).toBe("97%");

    state.quota.planType = "business";
    renderer.render();
    expect(dataBarOrder(els)).toEqual(["weekly", "weekly", "quotaEstimate"]);
  });

  it("设置打开时预览三栏草稿", () => {
    state.quota = createQuotaFixture("plus");
    state.settingsOpen = true;
    state.settingsDraft.dataBars = ["resetCredits", "fiveHour", "fiveHour"];

    renderer.render();

    expect(dataBarOrder(els)).toEqual(["resetCredits", "fiveHour", "fiveHour"]);
  });

  it("所选数据缺失时各栏显示占位符且不替换", () => {
    state.settings.dataBars = ["fiveHour", "resetCredits", "quotaEstimate"];
    state.quota = {
      planType: "plus",
      primary: null,
      secondary: { remainingPercent: 97, windowDurationMins: 10080 },
      resetCredits: null,
      quotaEstimate: null
    };

    renderer.render();

    expect(dataBarOrder(els)).toEqual(["fiveHour", "resetCredits", "quotaEstimate"]);
    expect(els.dataBarCards[0].querySelector("strong").textContent).toBe("--");
    expect(els.dataBarCards[1].querySelector("strong").textContent).toBe("--");
    expect(els.dataBarCards[2].querySelectorAll("strong")[0].textContent).toBe("--");
    expect(els.dataBarCards[2].querySelectorAll("strong")[1].textContent).toBe("--");
  });

  it("栏位离开额度估算后清理焦点和提示语义", () => {
    state.quota = createQuotaFixture();
    renderer.render();
    const firstCard = els.dataBarCards[0];
    expect(firstCard.getAttribute("role")).toBe("group");
    expect(firstCard.tabIndex).toBe(0);
    expect(firstCard.dataset.tooltip).toBeTruthy();

    state.settings.dataBars = ["weekly", "weekly", "resetCredits"];
    renderer.render();

    expect(firstCard.classList.contains("estimate-card")).toBe(false);
    expect(firstCard.hasAttribute("role")).toBe(false);
    expect(firstCard.hasAttribute("tabindex")).toBe(false);
    expect(firstCard.dataset.tooltip).toBeUndefined();
    expect(firstCard.hasAttribute("aria-label")).toBe(false);
  });

  it("按稳定状态展示上周和本周额度估算", () => {
    state.quota = createQuotaFixture();
    renderer.render();
    const estimateCard = els.dataBarCards[0];

    expect(estimateCard.querySelector(".estimate-title").textContent).toBe("额度估算");
    expect(estimateCard.querySelectorAll(".estimate-value")[0].textContent).toBe("$105");
    expect(estimateCard.querySelectorAll(".estimate-value")[1].textContent).toBe("--");
    expect(estimateCard.dataset.tooltip).toContain("样本或跨度不足");
    expect(estimateCard.dataset.tooltip).not.toContain("R²");
    expect(estimateCard.getAttribute("aria-label")).toContain("不等于实际账单");
    expect(els.dataBarCards[1].querySelector("strong").textContent).toBe("97%");
  });

  it("四套主题都能挂载套餐默认和重复布局", () => {
    const scenarios = [
      { planType: "plus", dataBars: null, expected: ["fiveHour", "weekly", "quotaEstimate"] },
      { planType: "business", dataBars: null, expected: ["quotaEstimate", "weekly", "resetCredits"] },
      {
        planType: "plus",
        dataBars: ["quotaEstimate", "quotaEstimate", "quotaEstimate"],
        expected: ["quotaEstimate", "quotaEstimate", "quotaEstimate"]
      }
    ];
    state.quota = createQuotaFixture();
    for (const theme of ["default", "basic1", "basic2", "basic3"]) {
      state.settings.theme = theme;
      for (const scenario of scenarios) {
        state.quota.planType = scenario.planType;
        state.settings.dataBars = scenario.dataBars;
        renderer.render();

        expect(document.body.dataset.theme).toBe(theme);
        expect(dataBarOrder(els)).toEqual(scenario.expected);
        document.querySelectorAll(".estimate-card").forEach((estimateCard) => {
          expect(estimateCard.querySelector('[data-lucide="wallet-cards"]')).not.toBeNull();
          expect(estimateCard.querySelectorAll(".estimate-value")[0].textContent).toBe("$105");
        });
        expect(els.meterHost.childElementCount).toBeGreaterThan(0);
      }
    }
  });

  it("额度估算卡支持键盘焦点并显示受限宽度提示", () => {
    vi.useFakeTimers();
    try {
      state.quota = createQuotaFixture();
      renderer.render();
      createTooltipController({ root: document.body }).bindEvents();
      const estimateCard = els.dataBarCards[0];

      estimateCard.focus();
      vi.advanceTimersByTime(1_000);

      const tooltip = document.querySelector(".app-tooltip");
      expect(document.activeElement).toBe(estimateCard);
      expect(tooltip.dataset.visible).toBe("true");
      expect(tooltip.dataset.placement).toBe("estimate");
      expect(tooltip.textContent).toContain("价格表 2026-08-25");
    } finally {
      vi.useRealTimers();
    }
  });
});

function createQuotaFixture(planType = "unknown") {
  return {
    planType,
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

function dataBarOrder(els) {
  return els.dataBarCards.map((card) => card.dataset.content);
}
