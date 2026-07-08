export function setText(element, value) {
  const nextValue = value ?? "";
  if (element.textContent !== nextValue) {
    element.textContent = nextValue;
  }
}

export function setAttribute(element, name, value) {
  if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

export function removeAttribute(element, name) {
  if (element.hasAttribute(name)) {
    element.removeAttribute(name);
  }
}

export function setDatasetValue(element, key, value) {
  if (element.dataset[key] !== value) {
    element.dataset[key] = value;
  }
}

export function setStyleValue(element, property, value) {
  if (element.style[property] !== value) {
    element.style[property] = value;
  }
}
