// The label of a button that opens the bestiary, shared by the camp (on the title's budget)
// and the bestiary panel itself (ui/bestiary.js, which loads with the game).

import { MONSTERS, loadBestiary, unread } from '../game/bestiary.js';

/** "Bestiary (met/all)", with a dot while new entries wait. */
export function bestiaryLabel(button) {
  const fresh = unread().length;
  button.textContent = `Bestiary (${loadBestiary().length}/${MONSTERS.length})`;
  button.classList.toggle('has-new', fresh > 0);
  if (fresh) button.setAttribute('aria-label', `${button.textContent}, ${fresh} new`);
  else button.removeAttribute('aria-label');
}
