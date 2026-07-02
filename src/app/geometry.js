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

export function workAreaForBallPosition(position, size, monitors) {
  if (!position || !Array.isArray(monitors) || monitors.length === 0) return null;

  const center = {
    x: position.x + size.width / 2,
    y: position.y + size.height / 2
  };
  const matched = monitors.find((monitor) => pointBelongsToWorkArea(center, monitor.workArea));
  if (matched) return matched.workArea;

  return monitors
    .map((monitor) => ({
      area: monitor.workArea,
      distance: distanceToWorkArea(center, monitor.workArea)
    }))
    .sort((first, second) => first.distance - second.distance)[0]?.area || null;
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

export function resolveSafeBallDock(position, size, area, monitors) {
  const bounds = workAreaBounds(area);
  const dock = resolveBallDock(position, size, bounds);
  if (!dock) return null;

  const y = clamp(position.y, bounds.top, Math.max(bounds.top, bounds.bottom - size.height));
  return edgeHasAdjacentWorkArea(area, dock, monitors, size, y) ? null : dock;
}

export function edgeHasAdjacentWorkArea(area, dock, monitors, size, y) {
  if (!Array.isArray(monitors) || monitors.length <= 1) return false;
  const bounds = workAreaBounds(area);
  const hiddenWidth = Math.round(size.width / 2);
  const hiddenRect =
    dock === "left"
      ? { left: bounds.left - hiddenWidth, top: y, right: bounds.left, bottom: y + size.height }
      : { left: bounds.right, top: y, right: bounds.right + hiddenWidth, bottom: y + size.height };

  return monitors.some((monitor) => {
    if (!monitor.workArea || sameWorkArea(area, monitor.workArea)) return false;
    return rectsIntersect(hiddenRect, workAreaBounds(monitor.workArea));
  });
}

function pointBelongsToWorkArea(point, area) {
  if (!area) return false;
  const bounds = workAreaBounds(area);
  return point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom;
}

function distanceToWorkArea(point, area) {
  const bounds = workAreaBounds(area);
  const dx = Math.max(bounds.left - point.x, 0, point.x - bounds.right);
  const dy = Math.max(bounds.top - point.y, 0, point.y - bounds.bottom);
  return Math.hypot(dx, dy);
}

function sameWorkArea(first, second) {
  const firstBounds = workAreaBounds(first);
  const secondBounds = workAreaBounds(second);
  return (
    firstBounds.left === secondBounds.left &&
    firstBounds.top === secondBounds.top &&
    firstBounds.right === secondBounds.right &&
    firstBounds.bottom === secondBounds.bottom
  );
}

function rectsIntersect(first, second) {
  return first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top;
}
