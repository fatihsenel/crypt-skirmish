// Tooltips for anything marked data-hint (in place of the browser's title, which can stay up
// over the next screen and never shows on a touch screen): a small card below the thing,
// after a pause under the mouse, at once on keyboard focus, or for a few seconds when a finger
// taps something that isn't a button. It goes when the thing is gone or hidden. Screen readers
// get the note too, always: a control's as its description, a label's as hidden text after it.

import { UnitTip } from './unitTip.js';

const SHOW_FOR = 3000; // ms a tapped hint stays up
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const CONTROL = 'button, a, input, select, textarea, [tabindex]';

/** Give screen readers every note under `root` (once each; a changed note replaces its own). */
function describe(root) {
  const els = root.matches?.('[data-hint]') ? [root] : [];
  els.push(...(root.querySelectorAll?.('[data-hint]') ?? []));
  for (const el of els) {
    const text = el.dataset.hint;
    if (!text || el.dataset.hintRead === text) continue;
    el.dataset.hintRead = text;
    const control = el.matches(CONTROL) ? el : el.matches('label') && el.querySelector(CONTROL);
    if (control) {
      control.setAttribute('aria-description', text);
      continue;
    }
    let note = el.querySelector(':scope > .hint-read');
    if (!note) {
      note = document.createElement('span');
      note.className = 'sr-only hint-read';
      el.append(note);
    }
    note.textContent = ` (${text})`;
  }
}

export function hints() {
  describe(document.body);
  new MutationObserver((changes) => {
    for (const c of changes) {
      if (c.type === 'attributes') describe(c.target);
      else for (const node of c.addedNodes) if (node.nodeType === 1) describe(node);
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-hint'] });

  const tip = new UnitTip();
  tip.el.id = 'hint-tip';
  const keys = new WeakMap();
  let n = 0;
  let on = null;
  let timer = 0;
  let watch = 0;
  const hide = () => {
    on = null;
    clearTimeout(timer);
    clearInterval(watch);
    tip.hide();
  };
  const show = (el, now) => {
    if (on && on !== el) hide();
    on = el;
    if (!keys.has(el)) keys.set(el, `hint:${++n}`);
    const html = () => `<p>${esc(el.dataset.hint)}</p>`;
    const rect = () => el.getBoundingClientRect();
    if (now) tip.show(html, rect(), 'below');
    else tip.hover(keys.get(el), html, rect, 'below');
    clearInterval(watch);
    watch = setInterval(() => { // the screen moved on under it
      if (!on || !on.isConnected || !on.getClientRects().length) hide();
    }, 250);
  };
  const of = (ev) => ev.target.closest?.('[data-hint]');
  document.addEventListener('pointerover', (ev) => {
    if (ev.pointerType !== 'mouse') return;
    const el = of(ev);
    if (el && el !== on) show(el);
    else if (!el && on) hide();
  });
  document.addEventListener('focusin', (ev) => {
    const el = of(ev);
    if (el && ev.target === el && el.matches(':focus-visible')) show(el, true);
  });
  document.addEventListener('focusout', (ev) => of(ev) === on && hide());
  document.addEventListener('pointerdown', (ev) => {
    const el = of(ev);
    if (ev.pointerType === 'mouse' || !el || el.closest('button, a, input, label, select')) return hide();
    show(el, true);
    timer = setTimeout(hide, SHOW_FOR);
  });
  document.addEventListener('keydown', (ev) => ev.key === 'Escape' && hide());
  document.addEventListener('scroll', () => on && hide(), { capture: true, passive: true });
}
