import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "../src/app/constants.js";
import {
  normalizeBallDock,
  normalizeDataBars,
  normalizeInputValue,
  normalizeSettings,
  normalizeWindowPosition,
  resolveDataBars
} from "../src/app/settings-model.js";

describe("设置标准化", () => {
  it("保留合法边界并修正坐标", () => {
    const settings = normalizeSettings({
      refreshIntervalMinutes: 1440,
      locale: "en",
      theme: "basic2",
      meterWindow: "primary",
      dataBars: ["weekly", "weekly", "quotaEstimate"],
      logLevel: "debug",
      widgetMode: "ball",
      panelPosition: { x: -10.6, y: 20.4 },
      ballDock: "right"
    });

    expect(settings).toMatchObject({
      refreshIntervalMinutes: 1440,
      locale: "en",
      theme: "basic2",
      meterWindow: "primary",
      dataBars: ["weekly", "weekly", "quotaEstimate"],
      logLevel: "debug",
      widgetMode: "ball",
      panelPosition: { x: -11, y: 20 },
      ballDock: "right"
    });
  });

  it.each([0, 1441, Number.NaN])("无效刷新间隔 %s 回退默认值", (value) => {
    expect(normalizeSettings({ refreshIntervalMinutes: value }).refreshIntervalMinutes)
      .toBe(DEFAULT_SETTINGS.refreshIntervalMinutes);
  });

  it("拒绝无效位置、停靠方向并清理空文本", () => {
    expect(normalizeWindowPosition({ x: "bad", y: 1 })).toBeNull();
    expect(normalizeBallDock("top")).toBeNull();
    expect(normalizeInputValue("   ")).toBeNull();
    expect(normalizeInputValue("  value  ")).toBe("value");
  });

  it("数据栏严格要求三个合法值并允许重复", () => {
    expect(normalizeDataBars(["weekly", "weekly", "quotaEstimate"]))
      .toEqual(["weekly", "weekly", "quotaEstimate"]);
    expect(normalizeDataBars(["weekly", "quotaEstimate"])).toBeNull();
    expect(normalizeDataBars(["weekly", "bad", "quotaEstimate"])).toBeNull();
  });

  it("未自定义数据栏时按套餐选择默认布局", () => {
    expect(resolveDataBars(null, " PLUS ")).toEqual(["fiveHour", "weekly", "quotaEstimate"]);
    expect(resolveDataBars(null, "business")).toEqual(["quotaEstimate", "weekly", "resetCredits"]);
    expect(resolveDataBars(null, null)).toEqual(["quotaEstimate", "weekly", "resetCredits"]);
    expect(resolveDataBars(["fiveHour", "fiveHour", "fiveHour"], "plus"))
      .toEqual(["fiveHour", "fiveHour", "fiveHour"]);
  });
});
