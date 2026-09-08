// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { createMeterController } from "../src/components/meters/meter-controller.js";

const THEMES = ["default", "basic1", "basic2", "basic3"];
const BASE_UPDATE = {
  theme: "default",
  percent: 42,
  angle: 151.2,
  level: "normal",
  label: "剩余",
  mode: "panel",
  dock: "none"
};

describe("仪表主题", () => {
  it.each(THEMES)("%s 主题独立挂载面板和悬浮球", (theme) => {
    const { root, controller } = createHarness();

    update(controller, { theme, percent: 42.4 });
    const mountedMeter = findMeter(root, theme);
    expect(root.childElementCount).toBe(1);
    expect(mountedMeter.dataset).toMatchObject({ level: "normal", mode: "panel", dock: "none" });
    expect(accessibleMeter(root).getAttribute("aria-label")).toBe("剩余 42%");

    update(controller, { theme, percent: 84.6, level: "low", mode: "ball", dock: "right" });
    expect(findMeter(root, theme)).toBe(mountedMeter);
    expect(mountedMeter.dataset).toMatchObject({ level: "low", mode: "ball", dock: "right" });
    expect(accessibleMeter(root).getAttribute("aria-label")).toBe("剩余 85%");

    controller.destroy();
    expect(root.childElementCount).toBe(0);
  });

  it.each(THEMES)("%s 主题钳制边界并拒绝非有限百分比", (theme) => {
    const { root, controller } = createHarness();
    const cases = [
      { percent: -20, expected: "0%" },
      { percent: 0, expected: "0%" },
      { percent: 42.5, expected: "43%" },
      { percent: 100, expected: "100%" },
      { percent: 120, expected: "100%" },
      { percent: null, expected: "--%" },
      { percent: undefined, expected: "--%" },
      { percent: Number.NaN, expected: "--%" },
      { percent: Number.POSITIVE_INFINITY, expected: "--%" },
      { percent: Number.NEGATIVE_INFINITY, expected: "--%" }
    ];

    for (const { percent, expected } of cases) {
      update(controller, { theme, percent });
      expect(accessibleMeter(root).getAttribute("aria-label")).toBe(`剩余 ${expected}`);
    }
  });

  it.each(THEMES)("%s 主题独立归一化状态字段", (theme) => {
    const { root, controller } = createHarness();

    update(controller, { theme, level: "", label: "", mode: "popup", dock: "top" });
    const meter = findMeter(root, theme);
    expect(meter.dataset).toMatchObject({ level: "unknown", mode: "panel", dock: "none" });
    expect(accessibleMeter(root).getAttribute("aria-label")).toBe("Quota 42%");

    update(controller, { theme, mode: "ball", dock: "left" });
    expect(meter.dataset).toMatchObject({ mode: "ball", dock: "left" });
  });

  it("默认主题独立维护空水位、波浪和满水位", () => {
    const { root, controller } = createHarness();
    update(controller, { theme: "default", percent: 0 });
    const meter = findMeter(root, "default");
    const frontBody = root.querySelector(".default-meter-front-wave-body");
    const frontStroke = root.querySelector(".default-meter-front-wave-stroke");
    const backBody = root.querySelector(".default-meter-back-wave-body");
    const backStroke = root.querySelector(".default-meter-back-wave-stroke");

    expect(meter.dataset.percent).toBe("0");
    expect([frontBody, frontStroke, backBody, backStroke].map((node) => node.getAttribute("d"))).toEqual([
      "",
      "",
      "",
      ""
    ]);

    update(controller, { theme: "default", percent: 50 });
    expect(meter.dataset.percent).toBe("50");
    expect(frontBody.getAttribute("d")).toMatch(/^M 0 50 /);
    expect(frontStroke.getAttribute("d")).toMatch(/^M 0 50 /);
    expect(backBody.getAttribute("d")).toMatch(/^M 0 51\.2 /);
    expect(backStroke.getAttribute("d")).toMatch(/^M 0 51\.2 /);

    update(controller, { theme: "default", percent: 100 });
    expect(meter.dataset.percent).toBe("100");
    expect(frontBody.getAttribute("d")).toBe("M 0 0 L 200 0 L 200 105 L 0 105 Z");
    expect([frontStroke, backBody, backStroke].map((node) => node.getAttribute("d"))).toEqual(["", "", ""]);
  });

  it("Basic1 独立维护单环进度和贴边布局", () => {
    const { root, controller } = createHarness();
    update(controller, { theme: "basic1", percent: 25 });
    const progress = root.querySelector(".basic1-gauge-progress");
    const inner = root.querySelector(".basic1-gauge-inner");
    const mark = root.querySelector(".basic1-gauge-mark");
    const percent = root.querySelector(".basic1-gauge-percent");
    const label = root.querySelector(".basic1-gauge-label");

    expect(progress.style.strokeDashoffset).toBe("75");
    expect(root.querySelector(".basic1-gauge-outer-progress")).toBeNull();
    expect(inner.getAttribute("transform")).toBe("");
    expect(mark.style.display).toBe("none");
    expect(percent.getAttribute("y")).toBe("78");
    expect(label.getAttribute("y")).toBe("98");

    update(controller, { theme: "basic1", mode: "ball", dock: "left" });
    const leftTransform = inner.getAttribute("transform");
    expect(leftTransform).not.toBe("");
    expect(mark.style.display).toBe("");
    expect(percent.getAttribute("y")).toBe("99");
    expect(label.style.display).toBe("none");

    update(controller, { theme: "basic1", mode: "ball", dock: "right" });
    expect(inner.getAttribute("transform")).not.toBe(leftTransform);
    update(controller, { theme: "basic1", mode: "ball", dock: "none" });
    expect(inner.getAttribute("transform")).toBe("");
  });

  it("Basic2 独立维护双环、角度变量和贴边布局", () => {
    const { root, controller } = createHarness();
    update(controller, { theme: "basic2", percent: 25, angle: 90 });
    const meter = findMeter(root, "basic2");
    const inner = root.querySelector(".basic2-gauge-inner");
    const mark = root.querySelector(".basic2-gauge-mark");
    const percent = root.querySelector(".basic2-gauge-percent");
    const label = root.querySelector(".basic2-gauge-label");

    expect(root.querySelector(".basic2-gauge-progress").style.strokeDashoffset).toBe("75");
    expect(root.querySelector(".basic2-gauge-outer-progress").style.strokeDashoffset).toBe("75");
    expect(meter.style.getPropertyValue("--remaining-angle")).toBe("90deg");
    expect(inner.getAttribute("transform")).toBe("");
    expect(mark.style.display).toBe("none");
    expect(percent.getAttribute("y")).toBe("75");
    expect(label.getAttribute("y")).toBe("96");

    update(controller, { theme: "basic2", mode: "ball", dock: "left" });
    const leftTransform = inner.getAttribute("transform");
    expect(leftTransform).not.toBe("");
    expect(mark.style.display).toBe("");
    expect(percent.getAttribute("y")).toBe("96");
    expect(label.style.display).toBe("none");

    update(controller, { theme: "basic2", mode: "ball", dock: "right" });
    expect(inner.getAttribute("transform")).not.toBe(leftTransform);
    update(controller, { theme: "basic2", mode: "ball", dock: "none" });
    expect(inner.getAttribute("transform")).toBe("");
  });

  it("Basic3 独立维护液位、刻度、折射和贴边布局", () => {
    const { root, controller } = createHarness();
    update(controller, { theme: "basic3", percent: 25 });
    const inner = root.querySelector(".basic3-gauge-inner");
    const mark = root.querySelector(".basic3-gauge-mark");
    const percent = root.querySelector(".basic3-gauge-percent");
    const label = root.querySelector(".basic3-gauge-label");

    expect(root.querySelector(".basic3-liquid").getAttribute("d")).not.toBe("");
    expect(root.querySelector(".basic3-gauge-ticks")).not.toBeNull();
    expect(root.querySelector(".basic3-gauge-refraction")).not.toBeNull();
    expect(inner.getAttribute("transform")).toBe("");
    expect(mark.style.display).toBe("none");
    expect(percent.getAttribute("y")).toBe("74");
    expect(label.getAttribute("y")).toBe("90");

    update(controller, { theme: "basic3", mode: "ball", dock: "left" });
    const leftTransform = inner.getAttribute("transform");
    expect(leftTransform).not.toBe("");
    expect(mark.style.display).toBe("");
    expect(percent.getAttribute("y")).toBe("99");
    expect(label.style.display).toBe("none");

    update(controller, { theme: "basic3", mode: "ball", dock: "right" });
    expect(inner.getAttribute("transform")).not.toBe(leftTransform);
    update(controller, { theme: "basic3", mode: "ball", dock: "none" });
    expect(inner.getAttribute("transform")).toBe("");
  });

  it("Basic3 液位连续下降，空额和无数据不留下液体，满额不留液面", () => {
    const { root, controller } = createHarness();
    let previousY = -Infinity;
    for (const percent of [100, 90, 60, 30, 10, 0]) {
      update(controller, { theme: "basic3", percent });
      const surface = root.querySelector(".basic3-liquid-surface");
      const y = Number(surface.dataset.levelY);
      expect(y).toBeGreaterThan(previousY);
      previousY = y;
      expect(surface.style.display).toBe(percent === 100 || percent === 0 ? "none" : "");
      expect(root.querySelector(".basic3-liquid").getAttribute("d") === "").toBe(percent === 0);
    }
    update(controller, { theme: "basic3", percent: null });
    expect(root.querySelector(".basic3-liquid").getAttribute("d")).toBe("");
    expect(root.querySelector(".basic3-liquid-surface").style.display).toBe("none");
    expect(findMeter(root, "basic3").dataset.percent).toBe("unknown");
  });

  it("Basic3 多实例的渐变与裁切引用各自独立，销毁一个不影响另一个", () => {
    const first = createHarness();
    const second = createHarness();
    update(first.controller, { theme: "basic3", percent: 30 });
    update(second.controller, { theme: "basic3", percent: 90 });
    const ids = [...first.root.querySelectorAll("[id]"), ...second.root.querySelectorAll("[id]")].map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const { root } of [first, second]) {
      for (const node of root.querySelectorAll("[fill], [stroke], [filter], [clip-path]")) {
        for (const name of ["fill", "stroke", "filter", "clip-path"]) {
          const match = node.getAttribute(name)?.match(/^url\(#(.+)\)$/);
          if (match) expect(root.querySelector(`[id="${match[1]}"]`)).not.toBeNull();
        }
      }
    }
    first.controller.destroy();
    expect(accessibleMeter(second.root).getAttribute("aria-label")).toBe("剩余 90%");
    expect(second.root.querySelector(".basic3-liquid").getAttribute("d")).not.toBe("");
  });

  it("Basic3 液体轮廓与亮线无接缝，波幅在边界收敛且不越出球内高度", () => {
    const { root, controller } = createHarness();
    for (const percent of [0.001, 1, 5, 10, 30, 60, 90, 95, 99, 99.999]) {
      update(controller, { theme: "basic3", percent });
      const front = root.querySelector(".basic3-liquid-surface").getAttribute("d");
      const rear = root.querySelector(".basic3-liquid-rear");
      expect(root.querySelector(".basic3-liquid").getAttribute("d")).toBe(`${front} V 115 H 16 Z`);
      expect(rear.getAttribute("d")).toBe(front);
      const coordinates = front.match(/-?\d+(?:\.\d+)?/g).map(Number);
      const heights = coordinates.filter((_, index) => index % 2 === 1);
      const y = heights[0];
      const maxDeviation = Math.max(...heights.map((height) => Math.abs(height - y)));
      expect(maxDeviation).toBeLessThanOrEqual(1.800001);
      if (percent < 10 || percent > 90) expect(maxDeviation).toBeLessThan(1.8);
      expect(Math.min(...heights)).toBeGreaterThanOrEqual(16);
      expect(Math.max(...heights)).toBeLessThanOrEqual(114);
    }
  });

  it("同主题复用节点，切换主题时替换节点", () => {
    const { root, controller } = createHarness();
    update(controller, { theme: "default" });
    const defaultMeter = root.firstElementChild;

    update(controller, { theme: "default", percent: 84 });
    expect(root.firstElementChild).toBe(defaultMeter);

    update(controller, { theme: "basic2" });
    expect(root.firstElementChild).not.toBe(defaultMeter);
    expect(defaultMeter.parentNode).toBeNull();
    expect(findMeter(root, "basic2")).toBe(root.firstElementChild);
  });

  it("未知主题稳定回退默认主题", () => {
    const { root, controller } = createHarness();
    update(controller, { theme: "toString" });
    const defaultMeter = findMeter(root, "default");

    update(controller, { theme: "__proto__", percent: 84 });
    expect(findMeter(root, "default")).toBe(defaultMeter);
    expect(accessibleMeter(root).getAttribute("aria-label")).toBe("剩余 84%");
  });

  it("销毁可重复调用，空根节点安全返回", () => {
    const { root, controller } = createHarness();
    update(controller, { theme: "basic3" });

    controller.destroy();
    controller.destroy();
    expect(root.childElementCount).toBe(0);

    const emptyController = createMeterController(null);
    expect(() => emptyController.update(BASE_UPDATE)).not.toThrow();
    expect(() => emptyController.destroy()).not.toThrow();
  });
});

function createHarness() {
  const root = document.createElement("div");
  return { root, controller: createMeterController(root) };
}

function update(controller, overrides = {}) {
  controller.update({ ...BASE_UPDATE, ...overrides });
}

function findMeter(root, theme) {
  const meter = root.querySelector(`.${theme}-meter`);
  expect(meter).not.toBeNull();
  return meter;
}

function accessibleMeter(root) {
  const meter = root.querySelector('[role="img"]');
  expect(meter).not.toBeNull();
  return meter;
}
