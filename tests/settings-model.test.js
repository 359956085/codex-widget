import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "../src/app/constants.js";
import {
  normalizeBallDock,
  normalizeInputValue,
  normalizeSettings,
  normalizeWindowPosition
} from "../src/app/settings-model.js";

describe("设置标准化", () => {
  it("保留合法边界并修正坐标", () => {
    const settings = normalizeSettings({
      refreshIntervalMinutes: 1440,
      locale: "en",
      theme: "basic2",
      meterWindow: "primary",
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
});
