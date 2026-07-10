export function mount(root) {
  const meter = document.createElement("div");
  meter.className = "default-meter";

  const rim = document.createElement("div");
  rim.className = "default-meter-rim";

  const fill = document.createElement("div");
  fill.className = "default-meter-fill";
  const waveOne = document.createElement("div");
  waveOne.className = "default-meter-wave default-meter-wave-one";
  const waveTwo = document.createElement("div");
  waveTwo.className = "default-meter-wave default-meter-wave-two";
  fill.append(waveOne, waveTwo);

  const shine = document.createElement("div");
  shine.className = "default-meter-shine";

  const copy = document.createElement("div");
  copy.className = "default-meter-copy";
  const percent = document.createElement("strong");
  const label = document.createElement("span");
  copy.append(percent, label);
  meter.append(rim, fill, shine, copy);
  root.replaceChildren(meter);

  function update({ percent: nextPercent, level, label: nextLabel, mode = "panel", dock = "none" }) {
    const value = typeof nextPercent === "number" ? clamp(nextPercent, 0, 100) : null;
    const displayText = value === null ? "--%" : `${Math.round(value)}%`;
    meter.dataset.level = level || "unknown";
    meter.dataset.mode = mode === "ball" ? "ball" : "panel";
    meter.dataset.dock = dock === "left" || dock === "right" ? dock : "none";
    fill.style.height = `${value === null ? 0 : value}%`;
    setText(percent, displayText);
    setText(label, nextLabel || "");
    // 吸附后窗口只露出半圆，隐藏说明文字可以避免内容被屏幕边缘裁切。
    label.hidden = meter.dataset.mode === "ball" && meter.dataset.dock !== "none";
    meter.setAttribute("role", "img");
    meter.setAttribute("aria-label", `${nextLabel || "Quota"} ${displayText}`);
  }

  function destroy() {
    if (meter.parentNode === root) root.replaceChildren();
  }

  return { update, destroy };
}

function setText(element, value) {
  if (element.textContent !== value) element.textContent = value;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
