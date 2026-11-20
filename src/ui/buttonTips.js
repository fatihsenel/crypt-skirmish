// Tooltips for the buttons in the top-right corner (threats, log, music, sound, settings):
// a small card with the button's name (data-tip), what it does (data-desc) and its key
// (data-key). A mouse shows it on hover and the keyboard on focus, both in CSS; a touch
// screen shows it on a long press, which then doesn't press the button.

import { longPress } from '../input.js';

const SHOW_FOR = 2500; // ms a long-pressed tip stays up

const esc = (t) => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export function buttonTips(row) {
  for (const b of row.querySelectorAll('button[data-tip]')) {
    const { tip, desc = '', key } = b.dataset;
    b.insertAdjacentHTML('beforeend', `<span class="corner-tip" aria-hidden="true"><span class="tip-row"><b>${esc(tip)}</b>${
      key ? `<kbd>${esc(key)}</kbd>` : ''}</span>${desc ? `<small>${esc(desc)}</small>` : ''}</span>`);
    if (desc) b.setAttribute('aria-description', key ? `${desc}. Key ${key}.` : desc);
  }
  // The card hangs from its button's right edge, shifted right if it would run off the
  // left of the screen; the arrow points at the middle of the button either way.
  const aim = (ev) => {
    const b = ev.target.closest?.('button[data-tip]');
    if (!b) return;
    const card = b.querySelector('.corner-tip');
    const right = b.getBoundingClientRect().right;
    const shift = Math.max(0, Math.min(8 - (right - card.offsetWidth), innerWidth - 8 - right));
    b.style.setProperty('--shift', `${Math.round(shift)}px`);
    b.style.setProperty('--arrow', `${Math.round(b.offsetWidth / 2 - 6.5 + shift)}px`);
  };
  row.addEventListener('pointerover', aim);
  row.addEventListener('focusin', aim);
  let shown = null;
  let timer = null;
  const hide = () => {
    clearTimeout(timer);
    shown?.classList.remove('tip-shown');
    shown = null;
  };
  const press = longPress(row, {
    target: (ev) => ev.target.closest('button[data-tip]'),
    show: (b) => {
      hide();
      aim({ target: b });
      shown = b;
      b.classList.add('tip-shown');
      timer = setTimeout(hide, SHOW_FOR);
    },
    hide,
  });
  row.addEventListener('pointerdown', (ev) => press.start(ev));
  // The lift that ends a long press would click the button: swallow it.
  row.addEventListener('click', (ev) => {
    if (press.consume()) {
      ev.stopPropagation();
      ev.preventDefault();
    }
  }, true);
  row.addEventListener('contextmenu', (ev) => ev.target.closest('button[data-tip]') && ev.preventDefault());
  document.addEventListener('pointerdown', (ev) => shown && !shown.contains(ev.target) && hide());
}
