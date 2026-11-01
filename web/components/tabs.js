"use strict";

// Reusable panel tabs: add data-tabs to a tablist and aria-controls to its tabs.
class TabSelector {
  static instances = new WeakMap();

  static mount(root) {
    if (!this.instances.has(root)) this.instances.set(root, new TabSelector(root));
    return this.instances.get(root);
  }

  constructor(root) {
    this.root = root;
    this.tabs = Array.from(root.querySelectorAll('[role="tab"]'));
    this.storageKey = root.dataset.tabsStorage;
    this.active = null;
    this.positioned = false;
    root.classList.add("tab-selector");
    root.setAttribute("role", "tablist");
    this.scroller = document.createElement("div");
    this.scroller.className = "tab-selector-scroll";
    this.scroller.setAttribute("role", "presentation");
    this.track = document.createElement("div");
    this.track.className = "tab-selector-track";
    this.track.setAttribute("role", "presentation");
    this.indicator = document.createElement("span");
    this.indicator.className = "tab-selector-indicator";
    this.indicator.setAttribute("aria-hidden", "true");
    for (const tab of this.tabs) {
      this.track.appendChild(tab);
      const panel = document.getElementById(tab.getAttribute("aria-controls"));
      if (panel) {
        panel.setAttribute("role", "tabpanel");
        panel.setAttribute("aria-labelledby", tab.id);
      }
    }
    this.track.appendChild(this.indicator);
    this.scroller.appendChild(this.track);
    root.appendChild(this.scroller);
    root.addEventListener("click", event => {
      const tab = event.target.closest('[role="tab"]');
      if (this.tabs.includes(tab)) this.select(tab.dataset.tab || tab.id);
    });
    root.addEventListener("keydown", event => {
      const tab = event.target.closest('[role="tab"]');
      if (!this.tabs.includes(tab) || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const enabled = this.tabs.filter(candidate => !candidate.disabled && candidate.getAttribute("aria-disabled") !== "true");
      const index = enabled.indexOf(tab);
      if (index < 0) return;
      event.preventDefault();
      const step = getComputedStyle(root).direction === "rtl" ? -1 : 1;
      const next = event.key === "Home" ? enabled[0] : event.key === "End" ? enabled.at(-1)
        : enabled[(index + (event.key === "ArrowRight" ? step : -step) + enabled.length) % enabled.length];
      this.select(next.dataset.tab || next.id, { focus: true });
    });
    let saved;
    try { if (this.storageKey) saved = sessionStorage.getItem(this.storageKey); } catch { /* Storage may be disabled. */ }
    const available = this.tabs.filter(tab => !tab.disabled && tab.getAttribute("aria-disabled") !== "true");
    const initial = available.find(tab => tab.getAttribute("aria-selected") === "true") || available[0];
    if (!this.select(saved) && initial) this.select(initial.dataset.tab || initial.id);
    this.resizeObserver = new ResizeObserver(() => this.measure());
    this.resizeObserver.observe(root);
    for (const tab of this.tabs) this.resizeObserver.observe(tab);
    document.fonts?.ready.then(() => this.measure());
  }

  select(value, { focus = false } = {}) {
    const selected = this.tabs.find(tab => (tab.dataset.tab || tab.id) === value && !tab.disabled && tab.getAttribute("aria-disabled") !== "true");
    if (!selected) return false;
    const changed = this.active !== selected;
    this.active = selected;
    for (const tab of this.tabs) {
      const active = tab === selected;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      const panel = document.getElementById(tab.getAttribute("aria-controls"));
      if (panel) panel.hidden = !active;
    }
    this.measure();
    if (focus) selected.focus({ preventScroll: true });
    try { if (this.storageKey) sessionStorage.setItem(this.storageKey, value); } catch { /* Selection works without storage. */ }
    if (changed) this.root.dispatchEvent(new CustomEvent("tabs:change", { bubbles: true, detail: { value, tab: selected } }));
    return true;
  }

  measure() {
    if (!this.active || !this.root.getBoundingClientRect().width) {
      this.positioned = false;
      this.root.removeAttribute("data-tabs-ready");
      return;
    }
    // Both elements share the scrolling track, so scrolling cannot detach the underline.
    const left = this.active.offsetLeft;
    const width = this.active.getBoundingClientRect().width;
    this.indicator.style.transform = "translateX(" + left + "px)";
    this.indicator.style.width = width + "px";
    if (!this.positioned) {
      // Measure the initial position without animating in from the left edge.
      this.indicator.getBoundingClientRect();
      this.root.setAttribute("data-tabs-ready", "");
      this.positioned = true;
    }
    const start = this.scroller.scrollLeft;
    const end = start + this.scroller.clientWidth;
    const target = left < start ? left : left + width > end ? left + width - this.scroller.clientWidth : start;
    if (target !== start) this.scroller.scrollTo({ left: target, behavior: "instant" });
  }
}

for (const root of document.querySelectorAll("[data-tabs]")) TabSelector.mount(root);
