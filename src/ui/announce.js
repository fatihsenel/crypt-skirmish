// What a screen reader says as the fight goes on: log lines, whose turn it is, and what the
// keyboard cursor rests on. A hidden live region (#announce in index.html) that only grows,
// so a burst of lines is read in order rather than each cutting off the last.

const KEEP = 8; // lines left in the region; older ones are dropped

export function announce(text) {
  const box = document.getElementById('announce');
  text = text?.replace(/\s+/g, ' ').trim();
  if (!box || !text) return;
  const p = document.createElement('p');
  p.textContent = text;
  box.appendChild(p);
  while (box.childElementCount > KEEP) box.firstElementChild.remove();
}
