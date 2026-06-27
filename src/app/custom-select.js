export function createCustomSelectController({ shells = [], onChange } = {}) {
  const records = Array.from(shells).map(createRecord).filter(Boolean);

  function bindEvents() {
    records.forEach((record) => {
      record.trigger.addEventListener("click", (event) => {
        event.preventDefault();
        toggle(record);
      });

      record.menu.addEventListener("click", (event) => {
        const option = event.target instanceof Element ? event.target.closest(".custom-select-option") : null;
        if (!option) return;
        selectOption(record, option.dataset.value || "");
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
    setAttribute(record.trigger, "aria-expanded", record.shell.classList.contains("open") ? "true" : "false");

    const signature = optionsSignature(record.select);
    if (record.optionsSignature !== signature) {
      record.optionsSignature = signature;
      record.optionButtons = createOptionButtons(record.select);
      record.menu.replaceChildren(...record.optionButtons);
      record.selectedValue = null;
    }

    if (record.selectedValue !== record.select.value) {
      record.selectedValue = record.select.value;
      syncSelectedOption(record);
    }
  }

  function toggle(record) {
    const shouldOpen = !record.shell.classList.contains("open");
    close(record);
    record.shell.classList.toggle("open", shouldOpen);
    syncRecord(record);
  }

  function close(exceptRecord = null) {
    records.forEach((record) => {
      if (record === exceptRecord || !record.shell.classList.contains("open")) return;
      record.shell.classList.remove("open");
      syncRecord(record);
    });
  }

  function selectOption(record, value) {
    record.select.value = value;
    record.select.dispatchEvent(new Event("change", { bubbles: true }));
    close();
  }

  return {
    bindEvents,
    close,
    sync
  };
}

function createRecord(shell) {
  const trigger = shell.querySelector(".custom-select-trigger");
  const menu = shell.querySelector(".custom-select-menu");
  const select = shell.querySelector("select");
  const valueNode = shell.querySelector(".custom-select-value");
  if (!(select instanceof HTMLSelectElement) || !trigger || !menu || !valueNode) return null;

  return {
    shell,
    trigger,
    menu,
    select,
    valueNode,
    optionsSignature: "",
    selectedValue: null,
    optionButtons: []
  };
}

function createOptionButtons(select) {
  return Array.from(select.options).map((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "custom-select-option";
    button.dataset.value = option.value;
    button.dataset.selected = option.value === select.value ? "true" : "false";
    button.textContent = option.textContent;
    if (option.value === select.value) {
      button.setAttribute("aria-current", "true");
    }
    return button;
  });
}

function syncSelectedOption(record) {
  record.optionButtons.forEach((option) => {
    const selected = option.dataset.value === record.select.value;
    option.dataset.selected = selected ? "true" : "false";
    if (selected) {
      option.setAttribute("aria-current", "true");
    } else {
      option.removeAttribute("aria-current");
    }
  });
}

function optionsSignature(select) {
  return Array.from(select.options)
    .map((option) => `${option.value}:${option.textContent}`)
    .join("|");
}

function setText(element, value) {
  if (element.textContent !== value) {
    element.textContent = value;
  }
}

function setAttribute(element, name, value) {
  if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}
