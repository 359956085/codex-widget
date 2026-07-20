import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatDateTimeOrPlaceholder,
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
});
