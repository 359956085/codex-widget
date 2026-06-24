import { SNAP_DISTANCE } from "./constants.js";

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function workAreaBounds(area) {
  return {
    left: area.position.x,
    top: area.position.y,
    right: area.position.x + area.size.width,
    bottom: area.position.y + area.size.height
  };
}

export function clampPositionToWorkArea(position, size, area) {
  const bounds = workAreaBounds(area);
  return {
    x: Math.round(clamp(position.x, bounds.left, Math.max(bounds.left, bounds.right - size.width))),
    y: Math.round(clamp(position.y, bounds.top, Math.max(bounds.top, bounds.bottom - size.height)))
  };
}

export function defaultTopRightPosition(size, area) {
  const bounds = workAreaBounds(area);
  return {
    x: Math.round(bounds.right - size.width - SNAP_DISTANCE),
    y: Math.round(bounds.top + SNAP_DISTANCE)
  };
}

export function positionBelongsToWorkArea(position, size, area) {
  if (!area) return false;
  const bounds = workAreaBounds(area);
  const centerX = position.x + size.width / 2;
  const centerY = position.y + size.height / 2;
  return centerX >= bounds.left && centerX <= bounds.right && centerY >= bounds.top && centerY <= bounds.bottom;
}

export function clampBallPositionToWorkArea(position, size, area, dock = null) {
  const bounds = workAreaBounds(area);
  const y = clamp(position.y, bounds.top, Math.max(bounds.top, bounds.bottom - size.height));
  let x = clamp(position.x, bounds.left, Math.max(bounds.left, bounds.right - size.width));

  if (dock === "left") {
    x = bounds.left - Math.round(size.width / 2);
  } else if (dock === "right") {
    x = bounds.right - Math.round(size.width / 2);
  }

  return {
    x: Math.round(x),
    y: Math.round(y)
  };
}

export function resolveBallDock(position, size, bounds) {
  const leftEdge = position.x;
  const rightEdge = position.x + size.width;
  const centerX = position.x + size.width / 2;
  const hitsLeftDock = leftEdge <= bounds.left + SNAP_DISTANCE;
  const hitsRightDock = rightEdge >= bounds.right - SNAP_DISTANCE;

  // 球体任一侧越过或进入吸附带，都代表用户想把悬浮球停靠到对应边缘。
  if (hitsLeftDock && hitsRightDock) {
    const boundsCenterX = bounds.left + (bounds.right - bounds.left) / 2;
    return centerX <= boundsCenterX ? "left" : "right";
  }
  if (hitsLeftDock) return "left";
  if (hitsRightDock) return "right";
  return null;
}
