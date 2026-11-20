// A won campaign as a picture to keep or post: the party, their numbers and gear, and the
// way they took down. Drawn on a canvas from runSummary() and saved as a PNG.

const W = 1200;
const H = 675;
const C = { bg: '#100d12', panel: '#1b1720', line: '#d9b45a55', gold: '#d9b45a', ink: '#ece4d4', muted: '#9d927f', hero: '#7fb0ff' };
const DISPLAY = "'Cinzel', Georgia, serif";
const BODY = "'Inter', system-ui, sans-serif";

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Splits `text` into lines no wider than `width`, at most `max` of them (the last gets "…"). */
function wrap(ctx, text, width, max, sep = ' ') {
  const words = text.split(sep);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line}${sep}${w}` : w;
    if (ctx.measureText(next).width > width && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  if (lines.length > max) {
    lines.length = max;
    lines[max - 1] = `${lines[max - 1]}…`;
  }
  return lines;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** `img` on a canvas of its own, fading out towards its edges. */
function feather(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const r = Math.min(c.width, c.height) / 2;
  const fade = g.createRadialGradient(c.width / 2, c.height / 2, r * 0.72, c.width / 2, c.height / 2, r);
  fade.addColorStop(0, '#000');
  fade.addColorStop(1, '#0000');
  g.globalCompositeOperation = 'destination-in';
  g.fillStyle = fade;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

/** The card as a canvas. `s` is runSummary(state). */
export async function drawRunCard(s, { date = new Date() } = {}) {
  try {
    await Promise.all([`700 56px ${DISPLAY}`, `600 20px ${BODY}`, `400 20px ${BODY}`].map((f) => document.fonts.load(f)));
  } catch { /* fall back to the system fonts */ }
  // The 3D emblem's still (the boot screen's), feathered into the card; the flat one if it fails.
  const still = await loadImage(`${import.meta.env.BASE_URL}boot-logo.jpg`);
  const emblem = still ? feather(still) : await loadImage(`${import.meta.env.BASE_URL}emblem.svg`);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Background: a dark vault with a warm glow behind the title.
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(260, 90, 10, 260, 90, 520);
  glow.addColorStop(0, '#d9b45a22');
  glow.addColorStop(1, '#d9b45a00');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  roundRect(ctx, 18, 18, W - 36, H - 36, 18);
  ctx.strokeStyle = C.gold;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Title block.
  const left = 60;
  let tx = left;
  if (still) {
    ctx.drawImage(emblem, left - 16, 36, 160, 139);
    tx = left + 150;
  } else if (emblem) {
    ctx.drawImage(emblem, left, 44, 96, 124);
    tx = left + 120;
  }
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.gold;
  ctx.font = `700 56px ${DISPLAY}`;
  ctx.fillText('Crypt Skirmish', tx, 98);
  ctx.fillStyle = C.ink;
  ctx.font = `600 24px ${BODY}`;
  ctx.fillText(`The crypt cleared on ${s.difficulty}`, tx, 136);
  ctx.fillStyle = C.muted;
  ctx.font = `400 19px ${BODY}`;
  const falls = s.heroes.reduce((n, h) => n + (h.downed ?? 0), 0);
  ctx.fillText([
    `${plural(s.won, 'room')} won`,
    s.lost ? `${plural(s.lost, 'fight')} lost` : 'no fight lost',
    plural(s.rounds, 'round'),
    ...(s.eliteCount ? [`${plural(s.eliteCount, 'elite')} slain`] : []),
    falls ? `heroes fell ${plural(falls, 'time')}` : 'no hero ever fell',
  ].join('  ·  '), tx, 168);

  // One panel per hero.
  const top = 204;
  const gap = 18;
  const n = s.heroes.length;
  const pw = (W - left * 2 - gap * (n - 1)) / n;
  const ph = 300;
  s.heroes.forEach((h, i) => {
    const x = left + i * (pw + gap);
    roundRect(ctx, x, top, pw, ph, 12);
    ctx.fillStyle = C.panel;
    ctx.fill();
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    ctx.stroke();
    const px = x + 18;
    const inner = pw - 36;
    ctx.fillStyle = C.hero;
    ctx.font = `700 26px ${DISPLAY}`;
    ctx.fillText(wrap(ctx, h.name, inner, 1)[0], px, top + 42);
    ctx.fillStyle = C.muted;
    ctx.font = `400 16px ${BODY}`;
    ctx.fillText(`${h.cls} · Level ${h.level}`, px, top + 66);

    const rows = [
      ['damage', 'Damage', h.damage],
      ['kills', 'Kills', h.kills],
      ['healing', 'Healing', h.healing],
      ['downed', 'Fell', h.downed ? plural(h.downed, 'time') : 'Never'],
    ];
    rows.forEach(([f, label, value], r) => {
      const y = top + 102 + r * 26;
      ctx.font = `400 17px ${BODY}`;
      ctx.fillStyle = C.muted;
      ctx.fillText(label, px, y);
      ctx.font = `600 17px ${BODY}`;
      ctx.fillStyle = h.best?.includes(f) ? C.gold : C.ink;
      ctx.textAlign = 'right';
      ctx.fillText(String(value ?? 0), px + inner, y);
      ctx.textAlign = 'left';
    });

    ctx.strokeStyle = C.line;
    ctx.beginPath();
    ctx.moveTo(px, top + 196);
    ctx.lineTo(px + inner, top + 196);
    ctx.stroke();
    ctx.font = `400 15px ${BODY}`;
    ctx.fillStyle = h.items?.length ? C.ink : C.muted;
    const items = h.items?.length ? wrap(ctx, h.items.join(', '), inner, 4, ', ').map((l, j, all) => (j < all.length - 1 ? `${l},` : l)) : ['No magic items'];
    items.forEach((l, j) => ctx.fillText(l, px, top + 222 + j * 20));
  });

  // The way down.
  const ry = top + ph + 42;
  ctx.fillStyle = C.muted;
  ctx.font = `700 15px ${DISPLAY}`;
  ctx.fillText('THE WAY DOWN', left, ry);
  ctx.fillStyle = C.ink;
  ctx.font = `400 17px ${BODY}`;
  wrap(ctx, (s.route ?? []).join(' → '), W - left * 2, 2, ' ').forEach((l, j) => ctx.fillText(l, left, ry + 28 + j * 24));

  // Footer.
  ctx.fillStyle = C.muted;
  ctx.font = `400 15px ${BODY}`;
  ctx.fillText(date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }), left, H - 40);
  ctx.textAlign = 'right';
  ctx.fillText('fatihsenel.github.io/crypt-skirmish', W - left, H - 40);
  ctx.textAlign = 'left';
  return canvas;
}

/**
 * Saves the card: the share sheet on a phone (so it can go to Photos or a chat), else a
 * download. Resolves to 'shared', 'saved' or 'cancelled'.
 */
export async function saveRunCard(s, { touch = false } = {}) {
  const canvas = await drawRunCard(s);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not draw the card');
  return saveImage(blob, 'crypt-skirmish-run.png', { touch });
}

/**
 * Saves a PNG: the share sheet on a phone, else a download (see saveRunCard). Photo mode
 * uses it too.
 */
export async function saveImage(blob, name, { touch = false } = {}) {
  const file = new File([blob], name, { type: 'image/png' });
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Crypt Skirmish' });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
      // fall through to a download
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'saved';
}
