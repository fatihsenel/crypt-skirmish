// The tooltip card over the action bar's buttons: attacks, spells and actions. With a mouse
// it shows on hover (after a short pause, then at once while moving along the row), and on
// keyboard focus; on a touch screen a long press shows it (and the press doesn't count as a
// tap), and the next touch anywhere hides it.
//
// Disabled buttons get no pointer events in some browsers, so the row finds the button under
// the pointer itself, from the buttons' boxes.

const HOVER_DELAY = 350;
const LONG_PRESS = 420;

export class AbilityTip {
  /** `content(key)` returns the card's HTML for a button's data-tip key, or null. */
  constructor(row, content) {
    this.row = row;
    this.content = content;
    this.el = document.createElement('div');
    this.el.id = 'ability-tip';
    this.el.className = 'tipcard';
    this.el.setAttribute('role', 'tooltip');
    this.el.hidden = true;
    document.getElementById('app').append(this.el);
    this.key = null;
    this.timer = 0;
    this.press = null;
    this.swallowClick = false;

    row.addEventListener('pointermove', (ev) => ev.pointerType === 'mouse' && this.hover(ev));
    row.addEventListener('pointerleave', (ev) => ev.pointerType === 'mouse' && this.hide());
    row.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType === 'mouse') return this.hide();
      this.startPress(ev);
    });
    row.addEventListener('pointermove', (ev) => {
      if (this.press && Math.hypot(ev.clientX - this.press.x, ev.clientY - this.press.y) > 10) this.cancelPress();
    });
    for (const type of ['pointerup', 'pointercancel']) row.addEventListener(type, () => this.cancelPress());
    row.addEventListener('scroll', () => this.hide(), { passive: true });
    // A long press that showed the card is not a tap on the button.
    row.addEventListener('click', (ev) => {
      if (!this.swallowClick) return;
      this.swallowClick = false;
      ev.stopPropagation();
      ev.preventDefault();
    }, true);
    row.addEventListener('contextmenu', (ev) => ev.target.closest('button.ability') && ev.preventDefault());
    document.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType !== 'mouse' && !this.el.hidden && !this.row.contains(ev.target)) this.hide();
    });
    row.addEventListener('focusin', (ev) => {
      const b = ev.target.closest('button.ability');
      if (b?.matches(':focus-visible')) this.show(b);
    });
    row.addEventListener('focusout', () => this.hide());
    window.addEventListener('resize', () => this.hide());
  }

  /** The ability button under a point, disabled or not. */
  buttonAt(x, y) {
    for (const b of this.row.querySelectorAll('button.ability[data-tip]')) {
      const r = b.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return b;
    }
    return null;
  }

  hover(ev) {
    const b = this.buttonAt(ev.clientX, ev.clientY);
    if (!b) return this.hide();
    if (b.dataset.tip === this.key && !this.el.hidden) return;
    clearTimeout(this.timer);
    if (!this.el.hidden) return this.show(b); // already reading: follow along the row
    this.key = b.dataset.tip;
    this.timer = setTimeout(() => {
      const now = this.buttonAt(ev.clientX, ev.clientY);
      if (now) this.show(now);
    }, HOVER_DELAY);
  }

  startPress(ev) {
    const b = this.buttonAt(ev.clientX, ev.clientY);
    this.hide();
    if (!b) return;
    this.press = { x: ev.clientX, y: ev.clientY };
    const key = b.dataset.tip;
    this.timer = setTimeout(() => {
      this.press = null;
      // The first touch switches the HUD to touch wording and redraws the row: find it again.
      const now = this.row.querySelector(`button.ability[data-tip="${CSS.escape(key)}"]`);
      if (!now) return;
      this.swallowClick = true;
      this.show(now);
    }, LONG_PRESS);
  }

  cancelPress() {
    if (!this.press) return;
    this.press = null;
    clearTimeout(this.timer);
  }

  show(button) {
    const html = this.content(button.dataset.tip);
    if (!html) return this.hide();
    clearTimeout(this.timer);
    this.key = button.dataset.tip;
    this.el.innerHTML = html;
    this.el.hidden = false;
    this.place(button);
  }

  /** The action bar was redrawn: point the open card at the new button, with fresh text. */
  refresh() {
    if (this.el.hidden) return;
    const b = this.row.querySelector(`button.ability[data-tip="${CSS.escape(this.key)}"]`);
    if (b) this.show(b);
    else this.hide();
  }

  hide() {
    clearTimeout(this.timer);
    this.el.hidden = true;
    this.key = null;
  }

  /**
   * Above the action bar (not just the button, so the hero's stats stay readable), centred
   * on the button and kept inside the screen; on a short screen, as close above it as fits.
   */
  place(button) {
    const r = button.getBoundingClientRect();
    const barTop = (button.closest('#actionbar') ?? button).getBoundingClientRect().top;
    const app = document.getElementById('app').getBoundingClientRect();
    const tip = this.el.getBoundingClientRect();
    const pad = 8;
    let left = r.left + r.width / 2 - tip.width / 2;
    left = Math.min(Math.max(left, app.left + pad), app.right - pad - tip.width);
    let top = barTop - tip.height - 8;
    if (top < app.top + pad) top = r.top - tip.height - 8; // a short screen: just above the button
    if (top < app.top + pad) top = app.top + pad;          // shorter still: as high as it goes
    const z = parseFloat(getComputedStyle(this.el).zoom) || 1; // the Text size setting scales these too
    this.el.style.left = `${(left - app.left) / z}px`;
    this.el.style.top = `${(top - app.top) / z}px`;
  }
}
