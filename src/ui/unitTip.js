// The card about a character: shown when the mouse rests on a figure or a turn-order
// portrait, or when a portrait is tapped on a touch screen. The Hud builds its text; this
// only shows, places and hides it.

const HOVER_DELAY = 300;

export class UnitTip {
  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'unit-tip';
    this.el.className = 'tipcard';
    this.el.setAttribute('role', 'tooltip');
    this.el.hidden = true;
    document.getElementById('app').append(this.el);
    this.key = null;
    this.timer = 0;
    window.addEventListener('resize', () => this.hide());
  }

  /**
   * Show `html()` beside `anchor()` (a DOMRect) after the hover pause, or at once if a card
   * is already up. `key` names what it is about, so hovering the same thing doesn't restart.
   * side: 'below' (the turn-order bar) or 'beside' (a figure on the board).
   */
  hover(key, html, anchor, side) {
    if (key === this.key) return;
    clearTimeout(this.timer);
    this.key = key;
    if (!this.el.hidden) return this.show(html, anchor(), side);
    this.timer = setTimeout(() => this.key === key && this.show(html, anchor(), side), HOVER_DELAY);
  }

  show(html, rect, side) {
    clearTimeout(this.timer);
    this.last = { html, side };
    const content = html();
    if (!content || !rect) return this.hide();
    this.el.innerHTML = content;
    this.el.hidden = false;
    this.place(rect, side);
  }

  /** The fight moved on: fresh numbers in the open card, where it is. */
  refresh() {
    if (this.el.hidden || !this.last) return;
    const content = this.last.html();
    if (!content) return this.hide();
    this.el.innerHTML = content;
  }

  hide() {
    clearTimeout(this.timer);
    this.el.hidden = true;
    this.key = null;
  }

  /** Kept inside the screen; beside a figure it goes right of it, or left if there's no room. */
  place(r, side) {
    const app = document.getElementById('app').getBoundingClientRect();
    const tip = this.el.getBoundingClientRect();
    const pad = 8;
    let left;
    let top;
    if (side === 'below') {
      left = r.left + r.width / 2 - tip.width / 2;
      top = r.bottom + 8;
    } else {
      left = r.right + 14;
      if (left + tip.width > app.right - pad) left = r.left - 14 - tip.width;
      top = r.top + r.height / 2 - tip.height / 2;
    }
    left = Math.min(Math.max(left, app.left + pad), app.right - pad - tip.width);
    // Beside a figure, stay between the turn-order bar and the action bar when it fits.
    let lo = app.top + pad;
    let hi = app.bottom - pad;
    if (side !== 'below') {
      const bar = document.getElementById('initiative')?.getBoundingClientRect();
      const actions = document.getElementById('actionbar')?.getBoundingClientRect();
      const inLo = bar?.height ? Math.max(lo, bar.bottom + pad) : lo;
      const inHi = actions?.height ? Math.min(hi, actions.top - pad) : hi;
      if (inHi - inLo >= tip.height) [lo, hi] = [inLo, inHi];
    }
    top = Math.min(Math.max(top, lo), hi - tip.height);
    this.el.style.left = `${left - app.left}px`;
    this.el.style.top = `${top - app.top}px`;
  }
}
