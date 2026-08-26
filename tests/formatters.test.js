import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatDateTimeOrPlaceholder,
  formatQuotaEstimateTooltip,
  formatQuotaEstimateUsd,
  formatResetCreditExpiries,
  formatResetCredits,
  formatWindowLabel,
  getVisualState,
  selectedMeterWindow
} from "../src/app/formatters.js";

describe("展示格式化", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("格式化重置次数和过期剩余时间", () => {
    expect(formatResetCredits(3)).toBe("3");
    expect(formatResetCredits(-1)).toBe("--");
    expect(formatResetCreditExpiries([
      "2026-01-01T02:00:00Z",
      "2026-01-01T00:01:00Z",
      "invalid"
    ], "success")).toBe("1m/2h");
    expect(formatResetCreditExpiries([], "success")).toBe("--");
  });

  it("覆盖窗口标签、视觉状态和无效日期", () => {
    expect(formatWindowLabel(60, "默认", {}, "zh")).toBe("1小时窗口");
    expect(formatWindowLabel(10080, "默认", {}, "zh")).toBe("周窗口");
    expect(formatWindowLabel(20160, "默认", {}, "zh")).toBe("2周窗口");
    expect(formatWindowLabel(10080, "default", {}, "en")).toBe("1w window");
    expect(getVisualState(null)).toBe("unknown");
    expect(getVisualState(0)).toBe("empty");
    expect(getVisualState(10)).toBe("critical");
    expect(getVisualState(49)).toBe("low");
    expect(getVisualState(50)).toBe("ready");
    expect(formatDateTimeOrPlaceholder("invalid", "zh")).toBe("--");
  });

  it("按配置选择额度窗口", () => {
    const quota = { primary: { remaining: 20 }, secondary: { remaining: 80 } };
    expect(selectedMeterWindow(quota, "primary")).toBe(quota.primary);
    expect(selectedMeterWindow(quota, "secondary")).toBe(quota.secondary);
  });

  it("只格式化稳定额度估算并统一使用美元前缀", () => {
    const ready = { status: "ready", fullQuotaUsd: 104.6 };
    expect(formatQuotaEstimateUsd(ready, "zh")).toBe("$105");
    expect(formatQuotaEstimateUsd(ready, "en")).toBe("$105");
    expect(formatQuotaEstimateUsd({ status: "collecting", fullQuotaUsd: 105 }, "zh")).toBe("--");
    expect(formatQuotaEstimateUsd({ status: "ready", fullQuotaUsd: Number.NaN }, "zh")).toBe("--");
  });

  it("额度估算提示包含样本指标和不可用状态", () => {
    const text = {
      estimateDisclaimer: "估算说明",
      estimatePrevious: "上周",
      estimateCurrent: "本周",
      estimatePriceTable: "价格表",
      estimateSamples: "样本",
      estimateSpan: "跨度",
      estimateUnpriced: "未计价",
      estimateCollecting: "仍在收集",
      estimateLoading: "正在获取数据",
      estimateUnavailable: "不可用"
    };
    const tooltip = formatQuotaEstimateTooltip({
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
        sampleCount: 10,
        percentSpan: 10,
        unpricedEventCount: 70
      }
    }, text, "zh");

    expect(tooltip).toContain("上周：$105");
    expect(tooltip).not.toContain("R²");
    expect(tooltip).toContain("本周：仍在收集");
    expect(tooltip).toContain("价格表 2026-08-25");
    const loadingTooltip = formatQuotaEstimateTooltip(null, text, "zh", { loading: true });
    expect(loadingTooltip).toContain("上周：正在获取数据");
    expect(loadingTooltip).toContain("本周：正在获取数据");
    expect(loadingTooltip).not.toContain("不可用");
    expect(formatQuotaEstimateTooltip(null, text, "zh")).toContain("上周：不可用");
    expect(formatQuotaEstimateTooltip({
      previous: null,
      current: {
        status: "unavailable",
        sampleCount: 0,
        percentSpan: 0,
        unpricedEventCount: 8
      }
    }, text, "zh")).toContain("跨度 0%, 未计价 8");
  });
});
