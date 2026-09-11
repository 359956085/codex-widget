// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { createMeterController } from "../src/components/meters/meter-controller.js";

describe("仪表增量更新", () => {
  it.each(["default", "basic1", "basic2", "basic3"])("%s 重复输入无 DOM 写入，真实变化及时更新", (theme) => {
    const root = document.createElement("div");
    const meter = createMeterController(root);
    const payload = { theme, percent: 60, angle: 216, label: "剩余", level: "normal", mode: "panel", dock: "none" };
    meter.update(payload);
    const observer = new MutationObserver(() => {});
    observer.observe(root, { subtree: true, attributes: true, characterData: true, childList: true });
    for (let index = 0; index < 100; index++) meter.update({ ...payload });
    expect(observer.takeRecords()).toHaveLength(0);
    for (const delta of [
      { percent: 0, angle: 0 }, { percent: 100, angle: 360 },
      { percent: NaN }, { percent: null }, { label: "Remaining" },
      { mode: "ball" }, { dock: "left" }, { dock: "right" }, { level: "low" }
    ]) {
      meter.update({ ...payload, ...delta });
      expect(observer.takeRecords().length).toBeGreaterThan(0);
      meter.update(payload);
      observer.takeRecords();
    }
    const oldNode = root.firstChild;
    meter.update({ ...payload, theme: theme === "default" ? "basic3" : "default" });
    meter.update(payload);
    expect(root.firstChild).not.toBe(oldNode);
    meter.destroy();
    meter.destroy();
    meter.update(payload);
    expect(root.textContent).toContain("60%");
    observer.disconnect();
    meter.destroy();
  });
});
