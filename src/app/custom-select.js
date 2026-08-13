import { setAttribute, setText } from "./dom-utils.js";

export function createCustomSelectController({ shells = [], onChange } = {}) {
  const records = Array.from(shells).map(createRecord).filter(Boolean);

  function bindEvents() {
    records.forEach((record) => {
      record.trigger.addEventListener("click", (event) => {
        event.preventDefault();
        toggle(record);
      });
      record.trigger.addEventListener("keydown", (event) => handleTriggerKeyDown(record, event));

      record.menu.addEventListener("click", (event) => {
        const option = event.target instanceof Element ? event.target.closest(".custom-select-option") : null;
        if (!option || !record.menu.contains(option)) return;
        selectOption(record, option.dataset.value || "");
      });
      record.menu.addEventListener("pointermove", (event) => {
        const option = event.target instanceof Element ? event.target.closest(".custom-select-option") : null;
        if (!option || !record.menu.contains(option)) return;
        setActiveIndex(record, Number.parseInt(option.dataset.index || "-1", 10));
      });

      record.select.addEventListener("change", () => {
        onChange?.(record.select.id, record.select.value);
        syncRecord(record);
      });
    });

    document.addEventListener("pointerdown", (event) => {
      if (event.target instanceof Element && event.target.closest(".custom-select-shell")) return;
      close();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close();
    });
  }

  function sync() {
    records.forEach(syncRecord);
  }

  function syncRecord(record) {
    const selectedOption = record.select.selectedOptions[0] || record.select.options[0];
    setText(record.valueNode, selectedOption?.textContent || "");
    record.trigger.disabled = record.select.disabled;
    setAttribute(record.trigger, "aria-disabled", record.select.disabled ? "true" : "false");

    const signature = optionsSignature(record.select);
    if (record.optionsSignature !== signature) {
      record.optionsSignature = signature;
      record.optionButtons = createOptionButtons(record.select);
      record.menu.replaceChildren(...record.optionButtons);
      record.selectedValue = null;
      record.activeIndex = selectedIndex(record);
    }

    if (record.selectedValue !== record.select.value) {
      record.selectedValue = record.select.value;
      syncSelectedOption(record);
      if (!record.shell.classList.contains("open")) record.activeIndex = selectedIndex(record);
    }
    syncExpandedState(record);
    syncActiveOption(record);
  }

  function toggle(record) {
    if (record.shell.classList.contains("open")) {
      closeRecord(record);
    } else {
      openRecord(record);
    }
  }

  function openRecord(record) {
    if (record.select.disabled) return;
    close(record);
    record.shell.classList.add("open");
    record.activeIndex = selectedIndex(record);
    if (record.activeIndex < 0) record.activeIndex = nextEnabledIndex(record, -1, 1);
    syncRecord(record);
  }

  function close(exceptRecord = null) {
    records.forEach((record) => {
      if (record !== exceptRecord) closeRecord(record);
    });
  }

  function closeRecord(record) {
    if (!record.shell.classList.contains("open")) return;
    record.shell.classList.remove("open");
    record.activeIndex = selectedIndex(record);
    syncRecord(record);
  }

  function selectOption(record, value) {
    const nativeOption = Array.from(record.select.options).find((option) => option.value === value);
    if (!nativeOption || nativeOption.disabled) return;
    record.select.value = value;
    record.select.dispatchEvent(new Event("change", { bubbles: true }));
    closeRecord(record);
    record.trigger.focus();
  }

  function handleTriggerKeyDown(record, event) {
    if (record.select.disabled) return;

    if (event.key === "Escape") {
      if (!record.shell.classList.contains("open")) return;
      event.preventDefault();
      event.stopPropagation();
      closeRecord(record);
      return;
    }
    if (event.key === "Tab") {
      closeRecord(record);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (record.shell.classList.contains("open")) {
        selectActiveOption(record);
      } else {
        openRecord(record);
      }
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;

    event.preventDefault();
    if (!record.shell.classList.contains("open")) {
      openRecord(record);
      return;
    }
    if (event.key === "Home") {
      setActiveIndex(record, nextEnabledIndex(record, -1, 1));
    } else if (event.key === "End") {
      setActiveIndex(record, nextEnabledIndex(record, record.optionButtons.length, -1));
    } else {
      setActiveIndex(record, nextEnabledIndex(record, record.activeIndex, event.key === "ArrowDown" ? 1 : -1));
    }
  }

  function selectActiveOption(record) {
    const option = record.optionButtons[record.activeIndex];
    if (option) selectOption(record, option.dataset.value || "");
  }

  function setActiveIndex(record, index) {
    if (!Number.isInteger(index) || index < 0 || index >= record.optionButtons.length) return;
    if (record.select.options[index]?.disabled) return;
    record.activeIndex = index;
    syncActiveOption(record);
  }

  return {
    bindEvents,
    close,
    sync
  };
}

function createRecord(shell, index) {
  const trigger = shell.querySelector(".custom-select-trigger");
  const menu = shell.querySelector(".custom-select-menu");
  const select = shell.querySelector("select");
  const valueNode = shell.querySelector(".custom-select-value");
  if (!(select instanceof HTMLSelectElement) || !trigger || !menu || !valueNode) return null;

  const controlId = select.id || `customSelect${index}`;
  const menuId = `${controlId}Listbox`;
  const labelledBy = trigger.getAttribute("aria-labelledby") || select.getAttribute("aria-labelledby");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");
  trigger.setAttribute("role", "combobox");
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-controls", menuId);
  trigger.setAttribute("aria-expanded", "false");
  if (labelledBy) trigger.setAttribute("aria-labelledby", labelledBy);
  menu.id = menuId;
  menu.setAttribute("role", "listbox");
  if (labelledBy) menu.setAttribute("aria-labelledby", labelledBy);

  return {
    shell,
    trigger,
    menu,
    select,
    valueNode,
    optionsSignature: "",
    selectedValue: null,
    optionButtons: [],
    activeIndex: -1
  };
}

function createOptionButtons(select) {
  return Array.from(select.options).map((option, index) => {
    const button = document.createElement("button");
    button.id = `${select.id || "customSelect"}Option${index}`;
    button.type = "button";
    button.tabIndex = -1;
    button.className = "custom-select-option";
    button.dataset.index = String(index);
    button.dataset.value = option.value;
    button.dataset.selected = option.value === select.value ? "true" : "false";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", option.value === select.value ? "true" : "false");
    if (option.disabled) {
      button.disabled = true;
      button.setAttribute("aria-disabled", "true");
    }
    button.textContent = option.textContent;
    return button;
  });
}

function syncSelectedOption(record) {
  record.optionButtons.forEach((option) => {
    const selected = option.dataset.value === record.select.value;
    option.dataset.selected = selected ? "true" : "false";
    option.setAttribute("aria-selected", selected ? "true" : "false");
  });
}

function syncExpandedState(record) {
  const isOpen = record.shell.classList.contains("open");
  setAttribute(record.trigger, "aria-expanded", isOpen ? "true" : "false");
  setAttribute(record.menu, "aria-hidden", isOpen ? "false" : "true");
}

function syncActiveOption(record) {
  const isOpen = record.shell.classList.contains("open");
  record.optionButtons.forEach((option, index) => {
    option.dataset.active = isOpen && index === record.activeIndex ? "true" : "false";
  });
  const activeOption = isOpen ? record.optionButtons[record.activeIndex] : null;
  if (activeOption) {
    record.trigger.setAttribute("aria-activedescendant", activeOption.id);
    activeOption.scrollIntoView?.({ block: "nearest" });
  } else {
    record.trigger.removeAttribute("aria-activedescendant");
  }
}

function selectedIndex(record) {
  return record.optionButtons.findIndex((option) => option.dataset.value === record.select.value);
}

function nextEnabledIndex(record, startIndex, direction) {
  for (let index = startIndex + direction; index >= 0 && index < record.optionButtons.length; index += direction) {
    if (!record.select.options[index]?.disabled) return index;
  }
  return -1;
}

function optionsSignature(select) {
  return Array.from(select.options)
    .map((option) => `${option.value}:${option.textContent}:${option.disabled}`)
    .join("|");
}
