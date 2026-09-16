import { describe, expect, it } from "vitest";

import {
  clampPositionToWorkArea,
  isBallAtInternalWorkAreaEdge,
  resolveSafeBallDock,
  resolveSafePanelDock,
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

  it("面板靠近边缘触发吸附，多屏内侧边缘受到保护", () => {
    const panelSize = { width: 390, height: 236 };
    // 靠近左侧边缘（<= 24px）吸附
    expect(resolveSafePanelDock({ x: 10, y: 200 }, panelSize, leftArea, monitors)).toBe("left");
    expect(resolveSafePanelDock({ x: -10, y: 200 }, panelSize, leftArea, monitors)).toBe("left");

    // 靠屏幕中央不吸附
    expect(resolveSafePanelDock({ x: 500, y: 200 }, panelSize, leftArea, monitors)).toBeNull();

    // 靠左侧工作区右边缘（多屏内部相交边界），安全检查拒绝吸附
    expect(resolveSafePanelDock({ x: 1530, y: 200 }, panelSize, leftArea, monitors)).toBeNull();

    // 靠最右侧外边缘吸附
    expect(resolveSafePanelDock({ x: 3840 - 390, y: 200 }, panelSize, rightArea, monitors)).toBe("right");
  });
});
