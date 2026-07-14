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
    // 设计稿的吸附态仍显示文字，由屏幕边缘自然裁切，保持球体与悬浮态视觉一致。
    label.hidden = false;
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
