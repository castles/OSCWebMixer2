# Tab selector

Load `components/tabs.css` after the page's base styles and `components/tabs.js` after the markup. Every `[data-tabs]` group is initialized automatically. Buttons and panels must have unique IDs across the page.

```html
<nav data-tabs data-tabs-storage="exampleTab" aria-label="Example" role="tablist">
  <button type="button" role="tab" id="tab-first" data-tab="first" aria-controls="panel-first" aria-selected="true">First</button>
  <button type="button" role="tab" id="tab-second" data-tab="second" aria-controls="panel-second" aria-selected="false">Second</button>
</nav>
<section id="panel-first" role="tabpanel">First panel</section>
<section id="panel-second" role="tabpanel" hidden>Second panel</section>
```

`data-tabs-storage` is optional and remembers the selected tab in session storage. Omit it for independent, unsaved selection. Override `--tab-line` and `--tab-active` to customize colours.

For a group inserted dynamically, call `TabSelector.mount(element)`. It returns the existing instance if already mounted. Use `instance.select("second", { focus: true })` for programmatic selection. Listen for the bubbling `tabs:change` event; `event.detail.value` identifies the selected tab.

The component manages panel visibility, ARIA relationships, keyboard navigation, horizontal overflow, resize and font measurements, and the animated underline. Reduced-motion preferences disable the animation.
