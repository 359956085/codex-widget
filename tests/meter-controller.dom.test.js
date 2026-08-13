// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { createMeterController } from "../src/components/meters/meter-controller.js";

describe("仪表主题", () => {
  it.each(["default", "basic1", "basic2", "basic3"])("挂载并更新 %s 主题", (theme) => {
    const root = document.createElement("div");
    const controller = createMeterController(root);

    controller.update({
      theme,
      percent: 42,
      angle: 151.2,
      level: "normal",
      label: "剩余",
      mode: "panel",
      dock: "none"
    });

    expect(root.childElementCount).toBe(1);
    expect(root.querySelector('[role="img"]')?.getAttribute("aria-label")).toContain("42%");
    controller.destroy();
    expect(root.childElementCount).toBe(0);
  });
});
