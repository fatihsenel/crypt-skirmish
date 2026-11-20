// A panel over the screen (the bestiary, past runs, achievements): closed by its Close button,
// a click on the backdrop or Escape, handing focus back to the button that opened it. While
// it's open, Tab and Shift+Tab stay inside it.

const FOCUSABLE = 'button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

/** The controls Tab can reach inside `el`: enabled and shown. */
export function focusables(el) {
  return [...el.querySelectorAll(FOCUSABLE)].filter((c) => !c.disabled && !c.closest('[hidden]') && c.getClientRects().length > 0);
}

export class Overlay {
  constructor(el) {
    this.el = el;
    for (const b of el.querySelectorAll('[data-close]')) b.addEventListener('click', () => this.close());
    el.addEventListener('click', (ev) => ev.target === el && this.close());
    document.addEventListener('keydown', (ev) => {
      if (el.hidden) return;
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        this.close();
      } else if (ev.key === 'Tab') {
        const list = focusables(el);
        if (!list.length) return;
        const at = list.indexOf(document.activeElement);
        const next = ev.shiftKey ? (at <= 0 ? list.at(-1) : null) : (at === -1 || at === list.length - 1 ? list[0] : null);
        if (next) {
          ev.preventDefault();
          next.focus();
        }
      }
    }, true);
  }

  open(opener) {
    this.opener = opener;
    this.el.hidden = false;
    this.el.querySelector('[data-close]')?.focus();
  }

  close() {
    this.el.hidden = true;
    this.opener?.focus();
  }
}
