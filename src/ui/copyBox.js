// Copying text for the player: the clipboard when the browser allows it, else a panel with
// the text selected, to copy by hand (some in-app browsers refuse the clipboard), or to save
// as a file when it runs to several lines (a whole combat log is a lot to select on a phone).

import { Overlay } from './overlay.js';

const $ = (sel) => document.querySelector(sel);
let box = null;

/** Put `text` on the clipboard; `button` reads Copied for a moment and then `label` again.
    If the clipboard is refused, the panel opens with the text selected; `what` names it. */
export async function copyText(text, { button, label, what }) {
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = label; }, 2000);
    return true;
  } catch {
    showCopyBox(text, what, button);
    return false;
  }
}

/** The panel with `text` selected in it, to copy by hand. */
export function showCopyBox(text, what, opener) {
  if (!box) {
    box = new Overlay($('#copy-box'));
    $('#copy-box-save').addEventListener('click', () => saveText($('#copy-box textarea').value, box.file));
  }
  box.file = `crypt-skirmish-${what.replace(/\s+/g, '-')}.txt`;
  $('#copy-box-save').hidden = !text.includes('\n');
  $('#copy-box-head').textContent = `Copy the ${what}`;
  const area = $('#copy-box textarea');
  area.value = text;
  area.rows = Math.min(14, Math.max(2, text.split('\n').length));
  box.open(opener);
  area.focus();
  area.select();
  area.setSelectionRange(0, text.length); // iOS ignores select() alone
}

/** Download `text` as a plain text file called `name`. */
function saveText(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
