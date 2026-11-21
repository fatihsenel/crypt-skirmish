// Tooltips for anything marked data-hint (in place of the browser's title, which can stay up
// over the next screen and never shows on a touch screen): a small card below the thing,
// after a pause under the mouse, at once on keyboard focus, or for a few seconds when a finger
// taps something that isn't a button. It goes when the thing is gone or hidden.

import { UnitTip } from './unitTip.js';

const SHOW_FOR = 3000; // ms a tapped hint stays up
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function hints() {
  const tip = new UnitTip();
  tip.el.id = 'hint-tip';
  const keys = new WeakMap();
  let n = 0;
  let on = null;
  let timer = 0;
  let watch = 0;
  const hide = () => {
    if (on?.getAttribute('aria-describedby') === 'hint-tip') on.removeAttribute('aria-describedby');
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
    if (!el.hasAttribute('aria-describedby')) el.setAttribute('aria-describedby', 'hint-tip');
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
