import {
  CalendarDays,
  CircleDot,
  Clock3,
  createElement as createLucideElement,
  Crown,
  FolderOpen,
  Minus,
  Pin,
  PinOff,
  RefreshCw,
  Settings,
  X
} from "lucide";

const ACTION_ICONS = {
  "calendar-days": CalendarDays,
  "circle-dot": CircleDot,
  "clock-3": Clock3,
  crown: Crown,
  "folder-open": FolderOpen,
  minus: Minus,
  pin: Pin,
  "pin-off": PinOff,
  "refresh-cw": RefreshCw,
  settings: Settings,
  x: X
};

export function initializeActionIcons(els) {
  [
    [els.modeBtn, "circle-dot"],
    [els.settingsBtn, "settings"],
    [els.pinBtn, "pin"],
    [els.refreshBtn, "refresh-cw"],
    [els.minimizeBtn, "minus"],
    [els.closeBtn, "x"],
    [els.settingsCloseBtn, "x"],
    [els.chooseCodexBtn, "folder-open"],
    [els.statusIcon, "refresh-cw"],
    [document.querySelector('[data-quota-icon="primary"]'), "clock-3"],
    [document.querySelector('[data-quota-icon="secondary"]'), "calendar-days"],
    [document.querySelector('[data-quota-icon="plan"]'), "crown"]
  ].forEach(([button, iconName]) => {
    setActionButtonIcon(button, iconName);
  });
}

export function updateActionButton(button, iconName, label, active = false) {
  button.title = label;
  button.setAttribute("aria-label", label);
  button.classList.toggle("active", active);

  // 图标 DOM 初始化后保持稳定，只在置顶状态切换时替换对应图标，避免每次刷新重建按钮。
  if (button.dataset.iconName === iconName) return;
  setActionButtonIcon(button, iconName);
}

function setActionButtonIcon(button, iconName) {
  if (!button) return;
  button.dataset.iconName = iconName;
  button.replaceChildren(createActionIcon(iconName));
}

export function createActionIcon(iconName) {
  const iconNode = ACTION_ICONS[iconName];
  if (!iconNode) {
    console.error("未知按钮图标", iconName);
    return document.createElement("span");
  }

  const [tag, attrs, children] = iconNode;
  return createLucideElement([
    tag,
    {
      ...attrs,
      "aria-hidden": "true",
      "data-lucide": iconName,
      class: `lucide lucide-${iconName}`
    },
    children
  ]);
}
