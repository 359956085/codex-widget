import { describe, expect, it } from "vitest";

import {
  clampPositionToWorkArea,
  isBallAtInternalWorkAreaEdge,
  resolveSafeBallDock,
  workAreaForBallPosition
} from "../src/app/geometry.js";

const ballSize = { width: 88, height: 88 };
const leftArea = {
  position: { x: 0, y: 0 },
  size: { width: 1920, height: 1040 }
};
const rightArea = {
  position: { x: 1920, y: 0 },
  size: { width: 1920, height: 1040 }
};
const monitors = [{ workArea: leftArea }, { workArea: rightArea }];

describe("窗口几何", () => {
  it("支持负坐标屏幕并限制窗口范围", () => {
    const area = {
      position: { x: -1920, y: -120 },
      size: { width: 1920, height: 1080 }
    };

    expect(clampPositionToWorkArea(
      { x: -2500, y: 1200 },
      { width: 390, height: 236 },
      area
    )).toEqual({ x: -1920, y: 724 });
  });

  it("内部相邻屏幕边缘不吸附，外侧边缘允许吸附", () => {
    expect(resolveSafeBallDock({ x: 1876, y: 200 }, ballSize, leftArea, monitors)).toBeNull();
    expect(isBallAtInternalWorkAreaEdge(
      { x: 1876, y: 200 },
      ballSize,
      leftArea,
      monitors
    )).toBe(true);
    expect(resolveSafeBallDock({ x: 0, y: 200 }, ballSize, leftArea, monitors)).toBe("left");
  });

  it("原屏幕移除后选择距离最近的工作区", () => {
    expect(workAreaForBallPosition(
      { x: 4200, y: 200 },
      ballSize,
      monitors
    )).toBe(rightArea);
  });
});
