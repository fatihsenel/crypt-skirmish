// The settings panel: a volume slider for music, effects and voices, and the monster-turn
// speed, and the dice: whether the player throws their own and whether rolls show. Opened from the Settings button beside Log, Music and Sound; every change
// applies at once and goes to onChange(key, value).

const $ = (sel) => document.querySelector(sel);

export class SettingsPanel {
  constructor(settings, onChange) {
    this.box = $('#settings');
    this.button = $('#settings-toggle');
    for (const input of this.box.querySelectorAll('input[type=range]')) {
      input.value = Math.round(settings[input.name] * 100);
      this.showLevel(input);
      input.addEventListener('input', () => {
        this.showLevel(input);
        onChange(input.name, Number(input.value) / 100);
      });
    }
    for (const radio of this.box.querySelectorAll('input[name=speed]')) {
      radio.checked = radio.value === settings.speed;
      radio.addEventListener('change', () => radio.checked && onChange('speed', radio.value));
    }
    for (const box of this.box.querySelectorAll('input[type=checkbox]')) {
      box.checked = settings[box.name];
      box.addEventListener('change', () => onChange(box.name, box.checked));
    }
    this.button.addEventListener('click', () => this.toggle());
    $('#settings-close').addEventListener('click', () => this.toggle(false));
    // Close on a click anywhere else, or Escape.
    document.addEventListener('pointerdown', (ev) => {
      if (this.open && !this.box.contains(ev.target) && !this.button.contains(ev.target)) this.toggle(false);
    });
    document.addEventListener('keydown', (ev) => {
      if (this.open && ev.key === 'Escape') {
        this.toggle(false);
        this.button.focus();
      }
    });
  }

  get open() {
    return !this.box.hidden;
  }

  toggle(open = !this.open) {
    this.box.hidden = !open;
    this.button.setAttribute('aria-expanded', String(open));
  }

  showLevel(input) {
    input.nextElementSibling.textContent = `${input.value}%`;
  }
}
