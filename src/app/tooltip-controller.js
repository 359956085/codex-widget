const TOOLTIP_DELAY_MS = 1000;
const VIEWPORT_PADDING = 8;
const MOUSE_OFFSET_X = 10;
const MOUSE_OFFSET_Y = 18;

export function createTooltipController({ root = document.body } = {}) {
  const tooltip = document.createElement("div");
  let activeTarget = null;
  let lastPointer = null;
  let showTimer = 0;
  let hideTimer = 0;

  tooltip.className = "app-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.setAttribute("aria-hidden", "true");
  tooltip.dataset.visible = "false";
  root.appendChild(tooltip);

  function bindEvents() {
    root.addEventListener("pointerover", handlePointerOver);
    root.addEventListener("pointermove", handlePointerMove);
    root.addEventListener("pointerout", handlePointerOut);
    root.addEventListener("focusin", handleFocusIn);
    root.addEventListener("focusout", handleFocusOut);
    root.addEventListener("pointerdown", hide);
    window.addEventListener("resize", hide);
    window.addEventListener("scroll", hide, true);
  }

  function handlePointerOver(event) {
    const target = findTooltipTarget(event.target);
    if (!target || target === activeTarget) return;
    lastPointer = pointerFromEvent(event);
    schedule(target);
  }

  function handlePointerMove(event) {
    if (!activeTarget) return;
    lastPointer = pointerFromEvent(event);
  }

  function handlePointerOut(event) {
    if (!activeTarget) return;
    const relatedTarget = event.relatedTarget instanceof Element ? event.relatedTarget : null;
    if (relatedTarget && activeTarget.contains(relatedTarget)) return;
    hide();
  }

  function handleFocusIn(event) {
    const target = findTooltipTarget(event.target);
    if (!target) return;
    lastPointer = null;
    schedule(target);
  }

  function handleFocusOut(event) {
    if (activeTarget && event.target === activeTarget) hide();
  }

  function schedule(target) {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    activeTarget = target;
    tooltip.dataset.visible = "false";
    tooltip.setAttribute("aria-hidden", "true");
    showTimer = window.setTimeout(() => show(target), TOOLTIP_DELAY_MS);
  }

  function show(target) {
    if (target !== activeTarget || !target.isConnected) return;
    const message = tooltipText(target);
    if (!message) return;

    tooltip.textContent = message;
    tooltip.dataset.placement = placementFor(target);
    positionTooltip(target);
    tooltip.dataset.visible = "true";
    tooltip.setAttribute("aria-hidden", "false");
  }

  function hide() {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    activeTarget = null;
    lastPointer = null;
    tooltip.dataset.visible = "false";
    tooltip.setAttribute("aria-hidden", "true");
  }

  function positionTooltip(target) {
    if (tooltip.dataset.placement === "ball") {
      positionBallTooltip();
      return;
    }

    tooltip.style.width = "max-content";
    tooltip.style.left = "0px";
    tooltip.style.top = "0px";

    const targetRect = target.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const anchorX = lastPointer?.x ?? targetRect.right;
    const anchorY = lastPointer?.y ?? targetRect.bottom;
    const preferredLeft = anchorX + MOUSE_OFFSET_X;
    const preferredTop = anchorY + MOUSE_OFFSET_Y;
    const fallbackTop = anchorY - tooltipRect.height - MOUSE_OFFSET_Y;
    const left = preferredLeft;
    const top = preferredTop + tooltipRect.height + VIEWPORT_PADDING > viewportHeight ? fallbackTop : preferredTop;

    tooltip.style.left = `${clamp(left, VIEWPORT_PADDING, viewportWidth - tooltipRect.width - VIEWPORT_PADDING)}px`;
    tooltip.style.top = `${clamp(top, VIEWPORT_PADDING, viewportHeight - tooltipRect.height - VIEWPORT_PADDING)}px`;
  }

  function positionBallTooltip() {
    tooltip.style.width = "max-content";
    const tooltipRect = tooltip.getBoundingClientRect();
    const anchorX = lastPointer?.x ?? window.innerWidth / 2;
    const anchorY = lastPointer?.y ?? window.innerHeight / 2;
    const preferredLeft = anchorX + MOUSE_OFFSET_X;
    const preferredTop = anchorY + MOUSE_OFFSET_Y;
    const fallbackTop = anchorY - tooltipRect.height - MOUSE_OFFSET_Y;
    const left = preferredLeft;
    const top = preferredTop + tooltipRect.height + 6 > window.innerHeight ? fallbackTop : preferredTop;

    tooltip.style.left = `${clamp(left, 6, window.innerWidth - tooltipRect.width - 6)}px`;
    tooltip.style.top = `${clamp(top, 6, window.innerHeight - tooltipRect.height - 6)}px`;
  }

  return { bindEvents, hide };
}

function findTooltipTarget(target) {
  if (!(target instanceof Element)) return null;
  const tooltipTarget = target.closest("[data-tooltip]");
  return tooltipText(tooltipTarget) ? tooltipTarget : null;
}

function tooltipText(target) {
  return target?.dataset.tooltip?.trim() || "";
}

function pointerFromEvent(event) {
  return {
    x: event.clientX,
    y: event.clientY
  };
}

function placementFor(target) {
  return document.body.dataset.widgetMode === "ball" && target.classList.contains("widget") ? "ball" : "top";
}

function clamp(value, min, max) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}
