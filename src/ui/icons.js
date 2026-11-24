// Small portraits for the initiative bar: a class icon for each hero and a silhouette for
// each monster. Hand-drawn 24×24 SVG that takes its colour from CSS (currentColor).

const svg = (body) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" stroke="currentColor" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;

/** A skull: cranium, eye sockets and teeth (used by the undead). */
const skull = (y = 0) => `
  <path stroke="none" d="M12 ${3 + y}c-4.4 0-7.5 3-7.5 7 0 2.3 1 3.9 2.5 4.9V${18 + y}h2v-1.5h2V${18 + y}h2v-1.5h2V${18 + y}h2v-3.1c1.5-1 2.5-2.6 2.5-4.9 0-4-3.1-7-7.5-7z"/>
  <circle cx="9" cy="${10.5 + y}" r="1.9" fill="var(--icon-hole)" stroke="none"/>
  <circle cx="15" cy="${10.5 + y}" r="1.9" fill="var(--icon-hole)" stroke="none"/>
  <path fill="var(--icon-hole)" stroke="none" d="M12 ${12.6 + y}l-1.1 2h2.2z"/>`;

const ICONS = {
  // --- heroes -------------------------------------------------------------------
  F: svg(`<path stroke="none" d="M13.2 2.5 11 2.5 11 14.5 13.2 14.5z"/>
    <path stroke="none" d="M12.1 1 10.6 3h3z"/>
    <rect stroke="none" x="7" y="14.5" width="10.2" height="2" rx="1"/>
    <rect stroke="none" x="11.1" y="16.5" width="2" height="4"/>
    <circle stroke="none" cx="12.1" cy="21.3" r="1.5"/>`),
  P: svg(`<path stroke="none" d="M12 2 20 5v6c0 5-3.4 8.9-8 11-4.6-2.1-8-6-8-11V5z"/>
    <path fill="var(--icon-hole)" stroke="none" d="M10.8 6h2.4v3.6h3.6V12h-3.6v6h-2.4v-6H7.2V9.6h3.6z"/>`),
  W: svg(`<path stroke="none" d="M12.6 1.5 7 16h11z"/>
    <path stroke="none" d="M3 17.5c2.5-1.3 5.6-2 9-2s6.5.7 9 2c-2.5 1.4-5.6 2.2-9 2.2s-6.5-.8-9-2.2z"/>
    <path fill="var(--icon-hole)" stroke="none" d="M12.4 7.5l.7 1.6 1.7.2-1.3 1.1.4 1.7-1.5-.9-1.5.9.4-1.7-1.3-1.1 1.7-.2z"/>`),
  R: svg(`<path stroke="none" d="M12 2c-4.4 0-7 3.6-7 8.2 0 3.4 1.2 6.4 3 8.3L6 22h12l-2-3.5c1.8-1.9 3-4.9 3-8.3C19 5.6 16.4 2 12 2z"/>
    <path fill="var(--icon-hole)" stroke="none" d="M12 7c-2.4 0-4 1.9-4 4.6 0 2.4 1.6 4.4 4 4.4s4-2 4-4.4C16 8.9 14.4 7 12 7z"/>
    <path stroke="none" d="M9.3 11.4h2.2v1.1H9.3zm3.2 0h2.2v1.1h-2.2z"/>`),
  // A drawn bow with an arrow on the string.
  A: svg(`<path fill="none" stroke-width="2.2" d="M6 2.5c7.5 2.2 11.5 7.4 11.5 9.5S13.5 19.3 6 21.5"/>
    <path fill="none" stroke-width="1" d="M6 2.5v19"/>
    <path fill="none" stroke-width="1.8" d="M3 12h16"/>
    <path stroke="none" d="M22.5 12 18 9.4v5.2z"/>
    <path stroke="none" d="M3 12 1.2 9.6h2.6L5.4 12l-1.6 2.4H1.2z"/>`),
  // A horned sigil: the fiend's mark.
  K: svg(`<path stroke="none" d="M3.5 2.5c.6 4.4 2.4 7.2 5.2 8.6l.9-1.9C7.4 8 5.6 5.6 3.5 2.5zM20.5 2.5c-.6 4.4-2.4 7.2-5.2 8.6l-.9-1.9c2.2-1.2 4-3.6 6.1-6.7z"/>
    <path stroke="none" d="M12 7.5c-3.3 0-5.6 2.7-5.6 6.2 0 3.6 2.6 7.8 5.6 7.8s5.6-4.2 5.6-7.8c0-3.5-2.3-6.2-5.6-6.2z"/>
    <path fill="var(--icon-hole)" stroke="none" d="M9 13.2l2.2.9-.4 1.2zm6 0-2.2.9.4 1.2zM10.6 18.3h2.8L12 19.6z"/>`),
  C: svg(`<circle stroke="none" cx="12" cy="12" r="4.2"/>
    <g stroke-width="1.9" fill="none">
      <path d="M12 2.2v3.2M12 18.6v3.2M2.2 12h3.2M18.6 12h3.2M5.1 5.1l2.2 2.2M16.7 16.7l2.2 2.2M5.1 18.9l2.2-2.2M16.7 7.3l2.2-2.2"/>
    </g>`),
  // Two beamed notes: the bard's song.
  B: svg(`<path stroke="none" d="M7.6 5.2 20.4 2.2v3.4L7.6 8.6z"/>
    <rect stroke="none" x="7.6" y="5.6" width="1.9" height="12"/>
    <rect stroke="none" x="18.5" y="2.6" width="1.9" height="12"/>
    <ellipse stroke="none" cx="5.8" cy="17.8" rx="3.2" ry="2.4" transform="rotate(-20 5.8 17.8)"/>
    <ellipse stroke="none" cx="16.7" cy="15" rx="3.2" ry="2.4" transform="rotate(-20 16.7 15)"/>`),
  // A double-bitted great axe.
  Z: svg(`<rect stroke="none" x="11" y="3" width="2" height="19" rx="1"/>
    <path stroke="none" d="M11 5.5C8 3.6 5 3.4 3 4.2c-.6 3.2-.6 6.4 0 9.6 2-.8 5-.6 8-2.5zM13 5.5c3-1.9 6-2.1 8-1.3.6 3.2.6 6.4 0 9.6-2-.8-5-.6-8-2.5z"/>`),
  // A flame: the sorcerer's blood.
  S: svg(`<path stroke="none" d="M12 1.8c.6 3.6 5.8 6.2 5.8 12 0 4.4-2.6 8.2-5.8 8.2s-5.8-3.8-5.8-8.2c0-2.9 1.3-4.6 2.5-5.9.2 1.9.9 3.2 2 3.9C10.4 8.6 11 5.2 12 1.8z"/>
    <path fill="var(--icon-hole)" stroke="none" d="M12 12.4c.4 1.9 2.6 3.2 2.6 5.6 0 1.6-1.2 2.6-2.6 2.6s-2.6-1-2.6-2.6c0-2.1 1.9-3 2.6-5.6z"/>`),
  // A closed fist.
  M: svg(`<path stroke="none" d="M6 9.2c0-1.3 1-2.2 2.2-2.2h8.6C18 7 19 8 19 9.2v6.3c0 3.6-2.8 6.5-6.4 6.5H11c-2.8 0-5-2.3-5-5.1z"/>
    <path fill="none" stroke="var(--icon-hole)" stroke-width="1.1" d="M9.6 7v5M12.6 7v5M15.6 7v5M6.2 12h9.2"/>
    <path stroke="none" d="M8 2.5h9v3H8z"/>`),
  // A leaf on its stem.
  D: svg(`<path stroke="none" d="M20.5 3.5C11 3.2 4.6 7.6 4.6 14.2c0 1.9.6 3.5 1.6 4.6C14.6 18.7 20.4 12.6 20.5 3.5z"/>
    <path fill="none" stroke="var(--icon-hole)" stroke-width="1.1" d="M7 17.6c3.2-3.4 6.8-6.8 11-11.4"/>
    <path fill="none" stroke-width="1.6" d="M6.6 18.4 3.2 21.6"/>`),
  // --- monsters -----------------------------------------------------------------
  g: svg(`<path stroke="none" d="M12 6c-3.3 0-5.6 2.4-5.9 5.4L1 8.5l3.4 5.4c.6 3.8 3.8 6.6 7.6 6.6s7-2.8 7.6-6.6L23 8.5l-5.1 2.9C17.6 8.4 15.3 6 12 6z"/>
    <path fill="var(--icon-hole)" stroke="none" d="M8.6 12.2l2.6 1.1-.5 1.2zm6.8 0-2.6 1.1.5 1.2zM10 17.2h4l-.8 1h-2.4z"/>`),
  b: svg(`<path stroke="none" d="M7.5 2.5 9.4 5 12 2l2.6 3 1.9-2.5V7h-9z"/>
    <path stroke="none" d="M12 8c-3.1 0-5.3 2.1-5.8 4.8L1.5 10.5l3 4.9c.8 3.3 3.8 5.6 7.5 5.6s6.7-2.3 7.5-5.6l3-4.9-4.7 2.3C17.3 10.1 15.1 8 12 8z"/>
    <path fill="var(--icon-hole)" stroke="none" d="M8.8 13.6l2.4 1-.5 1.1zm6.4 0-2.4 1 .5 1.1zM10 18h4l-.8.9h-2.4z"/>`),
  o: svg(`<path stroke="none" d="M12 3C7.6 3 5 6.3 5 10.5c0 1.5.3 2.8.8 4L4.5 18c1.9 2.3 4.6 3.5 7.5 3.5s5.6-1.2 7.5-3.5l-1.3-3.5c.5-1.2.8-2.5.8-4C19 6.3 16.4 3 12 3z"/>
    <path fill="var(--icon-hole)" stroke="none" d="M7.8 9.2l3.2 1.6-.4 1.3-3-1zm8.4 0-3.2 1.6.4 1.3 3-1zM8.5 15.5h7l-1 2.3h-5z"/>
    <path stroke="none" d="M8.6 16.6 8 13.4l1.6 2.4zm6.8 0 .6-3.2-1.6 2.4z"/>`),
  r: svg(`<path stroke="none" d="M3 15.5c0-3.3 3.1-6 7.5-6 2.6 0 4.7.9 6 2.3l2.8-.6 1.7 2.3-2.1 1.6c-.3 2.4-2.6 3.9-6.4 3.9H5.5C4 19 3 17.6 3 15.5z"/>
    <circle stroke="none" cx="14.5" cy="10" r="2.1"/>
    <circle fill="var(--icon-hole)" stroke="none" cx="17.7" cy="13.3" r=".8"/>
    <path fill="none" stroke-width="1.5" d="M4 17c-2 0-2.6 2.2-1 3.4 1.4 1 3.5.6 5.5.6"/>`),
  s: svg(skull(1.5)),
  n: svg(`<path stroke="none" d="M12 1.5 3.5 9.5V22h4v-5.5h9V22h4V9.5z"/>
    <path fill="var(--icon-hole)" stroke="none" d="M12 7.2c-2.6 0-4.4 1.8-4.4 4.3 0 1.5.6 2.6 1.6 3.3v1.9h5.6v-1.9c1-.7 1.6-1.8 1.6-3.3 0-2.5-1.8-4.3-4.4-4.3z"/>
    <circle stroke="none" cx="10.3" cy="11.6" r="1.1"/><circle stroke="none" cx="13.7" cy="11.6" r="1.1"/>`),
  u: svg(`<g fill="none" stroke-width="2.4">
      <path d="M5 3.5c1.6 5.3 1.6 11.2-.6 17"/><path d="M10.5 2.5c1.6 5.8 1.6 12.3-.6 19"/>
      <path d="M16 3.5c1.6 5.3 1.6 11.2-.6 17"/><path d="M21 6c.9 3.8.8 8-.5 12"/>
    </g>`),
  h: svg(`<g fill="none" stroke-width="2.3">
      <path d="M4.5 7c1.4 4 1.3 8.4-.5 12.8"/><path d="M9.8 6c1.4 4.4 1.3 9.2-.5 14"/><path d="M15 7c1.4 4 1.3 8.4-.5 12.8"/>
    </g>
    <g fill="none" stroke-width="1.5"><path d="M18.5 3c1.2 1 1.2 2 0 3s-1.2 2 0 3"/><path d="M21.5 5c1.2 1 1.2 2 0 3s-1.2 2 0 3"/></g>`),
  w: svg(`<path stroke="none" d="M6 1.5 8.3 4.6 12 1l3.7 3.6L18 1.5V6H6z"/>${skull(3)}`),
  m: svg(`<path stroke="none" d="M3 9.5C3 6.5 6.5 4 12 4s9 2.5 9 5.5V11H3z"/>
    <path stroke="none" d="M3 13h18v7.5H3z"/>
    <path fill="var(--icon-hole)" stroke="none" d="M3 11h18v2H3z"/>
    <path stroke="none" d="M4.5 11l1.3 2.6L7.2 11l1.3 2.6L9.8 11l1.3 2.6 1.3-2.6 1.3 2.6 1.3-2.6 1.3 2.6L17.6 11l1.3 2.6L20.2 11z"/>
    <path fill="var(--icon-hole)" stroke="none" d="M10.8 15.2h2.4v2.4h-2.4z"/>`),
  // act three: a spider (body and eight legs), a hooded wisp, and the banshee's crowned wisp
  k: svg(`<ellipse stroke="none" cx="12" cy="13.5" rx="4" ry="4.5"/><circle stroke="none" cx="12" cy="7.5" r="2.6"/>
    <path fill="none" stroke-width="1.8" d="M8.5 11 4 7.5 2 9.5M8.3 13.5H3.5L1.5 15.5M8.6 15.8 4.5 18.5l-1 3M9.5 17.5 7.5 21.5M15.5 11 20 7.5l2 2M15.7 13.5h4.8l2 2M15.4 15.8l4.1 2.7 1 3M14.5 17.5l2 4"/>`),
  e: svg(`<path stroke="none" d="M12 2C7.6 2 5 5.4 5 9.5V22l2.3-2 2.4 2 2.3-2 2.3 2 2.4-2L19 22V9.5C19 5.4 16.4 2 12 2z"/>
    <ellipse cx="9.4" cy="10" rx="1.4" ry="2" fill="var(--icon-hole)" stroke="none"/>
    <ellipse cx="14.6" cy="10" rx="1.4" ry="2" fill="var(--icon-hole)" stroke="none"/>
    <ellipse cx="12" cy="15" rx="1.3" ry="1.8" fill="var(--icon-hole)" stroke="none"/>`),
  q: svg(`<path stroke="none" d="M7 1.5 8.8 4 12 1l3.2 3L17 1.5V5H7z"/>
    <path stroke="none" d="M12 5.5c-4 0-6.5 3-6.5 6.8V22l2.2-1.8 2.1 1.8 2.2-1.8 2.2 1.8 2.1-1.8 2.2 1.8v-9.7c0-3.8-2.5-6.8-6.5-6.8z"/>
    <ellipse cx="9.6" cy="12" rx="1.3" ry="1.8" fill="var(--icon-hole)" stroke="none"/>
    <ellipse cx="14.4" cy="12" rx="1.3" ry="1.8" fill="var(--icon-hole)" stroke="none"/>
    <ellipse cx="12" cy="16.5" rx="1.5" ry="2.2" fill="var(--icon-hole)" stroke="none"/>`),
  // act four: a bandaged head, a hooded wraith with a scythe, a closed knight's helm, and the
  // mummy lord's bandaged head under a crown
  y: svg(`<path stroke="none" d="M12 3c-4.1 0-7 3.1-7 7.2V20h14v-9.8C19 6.1 16.1 3 12 3z"/>
    <path fill="none" stroke="var(--icon-hole)" stroke-width="1.2" d="M5.5 8.2 18.5 6.8M5.2 12.4 18.8 11M5.2 16.6l13.6-1.2"/>
    <circle cx="9.3" cy="10" r="1.3" fill="var(--icon-hole)" stroke="none"/>
    <circle cx="14.7" cy="9.6" r="1.3" fill="var(--icon-hole)" stroke="none"/>`),
  t: svg(`<path stroke="none" d="M11 2.5C7 2.5 4.5 5.8 4.5 10V22l2-1.6 2 1.6 2-1.6 2 1.6 2-1.6 2 1.6V10c0-4.2-2.5-7.5-6.5-7.5z"/>
    <path fill="var(--icon-hole)" stroke="none" d="M11 7c-2.2 0-3.6 1.8-3.6 4.2 0 1.6.7 3 1.8 3.8h3.6c1.1-.8 1.8-2.2 1.8-3.8C14.6 8.8 13.2 7 11 7z"/>
    <path fill="none" stroke-width="1.8" d="M20 3v19M20 3c-2.4.2-4.4 1.4-5.5 3.2"/>`),
  x: svg(`<path stroke="none" d="M12 1.8c-4.6 0-7.5 3.3-7.5 8V20l2.5 2h10l2.5-2V9.8c0-4.7-2.9-8-7.5-8z"/>
    <path fill="var(--icon-hole)" stroke="none" d="M6.5 10.2h11v1.8h-11zM11.1 12h1.8v7h-1.8z"/>`),
  l: svg(`<path stroke="none" d="M6.5 1.5 8.5 4.5 12 1.5l3.5 3 2-3V6h-11z"/>
    <path stroke="none" d="M12 6.5c-3.9 0-6.5 2.8-6.5 6.6V22h13v-8.9c0-3.8-2.6-6.6-6.5-6.6z"/>
    <path fill="none" stroke="var(--icon-hole)" stroke-width="1.1" d="M6 10.5l12-1.2M5.8 14.6 18.2 13.4M5.8 18.6 18.2 17.4"/>
    <circle cx="9.5" cy="12.2" r="1.2" fill="var(--icon-hole)" stroke="none"/>
    <circle cx="14.5" cy="11.8" r="1.2" fill="var(--icon-hole)" stroke="none"/>`),
  // act five: a gargoyle's horned head with bat wings, the basilisk's lizard head with its
  // staring eye, and the minotaur's horned bull head
  a: svg(`<path stroke="none" d="M1.5 6c2.5.3 4.4 1.6 5.6 3.6L7 15c-2.2-.6-4.2-2.2-5.5-4.6l2-.4-2.6-2.2zM22.5 6c-2.5.3-4.4 1.6-5.6 3.6L17 15c2.2-.6 4.2-2.2 5.5-4.6l-2-.4 2.6-2.2z"/>
    <path stroke="none" d="M8 3.5 9.6 7h4.8L16 3.5l.2 5.3c.9 1.1 1.3 2.4 1.3 3.9 0 3.9-2.5 7.8-5.5 9.3-3-1.5-5.5-5.4-5.5-9.3 0-1.5.4-2.8 1.3-3.9z"/>
    <path fill="var(--icon-hole)" stroke="none" d="M9.2 11.2l2 .9-2 .9zM14.8 11.2l-2 .9 2 .9zM10.4 17h3.2l-1.6 1.6z"/>`),
  z: svg(`<path stroke="none" d="M2 13.5C2.8 8.6 7 5.5 12.6 5.5c4.6 0 8 2.2 9.4 5.6l-3.4 1.3 3.4 1.6c-1.5 3.1-5.1 4.9-9.6 4.9C7 18.9 2.8 17.4 2 13.5z"/>
    <circle cx="11.5" cy="10.2" r="2.4" fill="var(--icon-hole)" stroke="none"/>
    <circle cx="11.5" cy="10.2" r="1" stroke="none"/>
    <path fill="none" stroke="var(--icon-hole)" stroke-width="1.1" d="M14.6 14.6c2 .1 4-.3 5.6-1.1"/>`),
  // the ochre jelly: a lumpy mound with a bone afloat in it
  j: svg(`<path stroke="none" d="M2 19.5c0-3.4 1.6-5.2 3.6-5.6.2-3.8 2.6-7.4 6.4-7.4 2.7 0 4.4 1.6 5 3.6 2.6.2 5 2.6 5 6.2 0 1.3-.3 2.3-.8 3.2z"/>
    <path fill="none" stroke="var(--icon-hole)" stroke-width="1.3" stroke-linecap="round" d="M8.5 15.5l5.5-2.5"/>
    <circle cx="16.5" cy="15.5" r="1.1" fill="var(--icon-hole)" stroke="none"/>
    <circle cx="10" cy="10.5" r=".8" fill="var(--icon-hole)" stroke="none"/>`),
  // rules 8: a zombie's slumped head with stitched mouth, and three rats in a heap for the swarm
  d: svg(`<path stroke="none" d="M12 3C8 3 5.2 6 5.2 10.2c0 2.3.8 4.2 2.1 5.5V21h9.4v-5.3c1.3-1.3 2.1-3.2 2.1-5.5C18.8 6 16 3 12 3z"/>
    <circle cx="9.3" cy="10.4" r="1.5" fill="var(--icon-hole)" stroke="none"/>
    <circle cx="14.9" cy="11" r="1" fill="var(--icon-hole)" stroke="none"/>
    <path fill="none" stroke="var(--icon-hole)" stroke-width="1.1" d="M8.8 16.2h6.4M10 15.2v2M12 15.2v2M14 15.2v2"/>`),
  c: svg(`<path stroke="none" d="M2 19c0-2.2 2-4 4.8-4 1.7 0 3 .6 3.8 1.5l1.8-.4 1 1.5-1.3 1C11.9 20.2 10.4 21 8 21H3.5C2.6 21 2 20.2 2 19z"/>
    <path stroke="none" d="M11.5 18.5c0-2.2 2-4 4.8-4 1.7 0 3 .6 3.8 1.5l1.8-.4 1 1.5-1.3 1c-.2 1.6-1.7 2.4-4.1 2.4H13c-.9 0-1.5-.8-1.5-2z"/>
    <path stroke="none" d="M6 11c0-2.2 2-4 4.8-4 1.7 0 3 .6 3.8 1.5l1.8-.4 1 1.5-1.3 1c-.2 1.6-1.7 2.4-4.1 2.4H7.5C6.6 13 6 12.2 6 11z"/>
    <path fill="none" stroke-width="1.2" d="M6 11.5c-1.5 0-2.5 1-2.5 2.2M2 19.5c-1 .2-1.4 1-1 1.5"/>`),
  // the gelatinous cube: a see-through block with a skull caught inside
  i: svg(`<path fill="none" stroke-width="1.6" stroke-linejoin="round" d="M4 8.5L12 5l8 3.5v9L12 21l-8-3.5z"/>
    <path fill="none" stroke-width="1.1" opacity=".6" d="M4 8.5l8 3.5 8-3.5M12 12v9"/>
    <circle cx="9.6" cy="14.6" r="2" stroke="none"/>
    <circle cx="9" cy="14.4" r=".5" fill="var(--icon-hole)" stroke="none"/>
    <circle cx="10.3" cy="14.4" r=".5" fill="var(--icon-hole)" stroke="none"/>`),
  v: svg(`<path stroke="none" d="M1.5 4.5c.4 3.8 2.5 6 5.6 6.4L8 8.4C5.6 8.2 3.4 6.9 1.5 4.5zM22.5 4.5c-.4 3.8-2.5 6-5.6 6.4L16 8.4c2.4-.2 4.6-1.5 6.5-3.9z"/>
    <path stroke="none" d="M12 6.5c-3.4 0-5.5 2.3-5.5 5.3 0 1.5.4 2.6 1 3.7L8 19.2c.4 1.8 2 2.8 4 2.8s3.6-1 4-2.8l.5-3.7c.6-1.1 1-2.2 1-3.7 0-3-2.1-5.3-5.5-5.3z"/>
    <circle cx="9.4" cy="11.6" r="1.2" fill="var(--icon-hole)" stroke="none"/>
    <circle cx="14.6" cy="11.6" r="1.2" fill="var(--icon-hole)" stroke="none"/>
    <path fill="none" stroke="var(--icon-hole)" stroke-width="1.2" d="M10.5 18.6c.9.4 2.1.4 3 0"/>`),
  unknown: svg(`<path fill="none" stroke-width="2.4" d="M8.8 8.6c0-2 1.5-3.4 3.4-3.4 2 0 3.4 1.3 3.4 3.1 0 2.6-3.4 2.8-3.4 5.6"/>
    <circle stroke="none" cx="12.2" cy="18.3" r="1.6"/>`),
};

/** The portrait for a unit (by template code), or the "unknown" mark. */
export function unitIcon(unit) {
  return ICONS[unit?.code] ?? ICONS.unknown;
}

export const unknownIcon = () => ICONS.unknown;
