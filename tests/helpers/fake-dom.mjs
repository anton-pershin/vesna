export class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = '';
    this.hidden = false;
    this.disabled = false;
    this.scrollCalls = [];
    this._textContent = '';
    this.classList = {
      toggle: (name, force) => {
        const names = new Set(this.className.split(/\s+/).filter(Boolean));
        if (force) names.add(name);
        else names.delete(name);
        this.className = [...names].join(' ');
      },
    };
  }

  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }

  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent).join('');
  }

  append(...children) {
    for (const child of children) {
      child.parentNode = this;
      this.children.push(child);
    }
  }

  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(name, handler) {
    const handlers = this.listeners.get(name) ?? [];
    handlers.push(handler);
    this.listeners.set(name, handlers);
  }

  dispatch(name) {
    for (const handler of this.listeners.get(name) ?? []) handler({ target: this });
  }

  querySelector(selector) {
    const matches = (element) => {
      if (selector.startsWith('.')) {
        return element.className.split(/\s+/).includes(selector.slice(1));
      }
      return element.tagName.toLowerCase() === selector.toLowerCase();
    };
    for (const child of this.children) {
      if (matches(child)) return child;
      const descendant = child.querySelector(selector);
      if (descendant) return descendant;
    }
    return null;
  }

  scrollIntoView(options) {
    this.scrollCalls.push(options);
  }
}

export class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName);
  }
}
