"use strict";

// Run synchronously in the head: apply saved geometry before the sidebar can paint.
(() => {
  const root = document.documentElement;
  const state = {
    collapsed: false,
    set(collapsed, { persist = true } = {}) {
      this.collapsed = Boolean(collapsed);
      root.classList.toggle("sidebar-collapsed", this.collapsed);
      if (persist) {
        try { localStorage.setItem("adminSidebarCollapsed", String(this.collapsed)); } catch { /* Storage may be unavailable. */ }
      }
    },
  };
  let saved = false;
  try { saved = localStorage.getItem("adminSidebarCollapsed") === "true"; } catch { /* Use the expanded layout when storage is unavailable. */ }
  state.set(saved, { persist: false });
  window.AdminSidebarState = state;
  root.setAttribute("data-sidebar-ready", "");
})();
