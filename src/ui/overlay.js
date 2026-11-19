// A panel over the screen (the bestiary, past runs, achievements): closed by its Close button,
// a click on the backdrop or Escape, handing focus back to the button that opened it.

export class Overlay {
  constructor(el) {
    this.el = el;
    for (const b of el.querySelectorAll('[data-close]')) b.addEventListener('click', () => this.close());
    el.addEventListener('click', (ev) => ev.target === el && this.close());
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !el.hidden) {
        ev.stopPropagation();
        this.close();
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
