// Links to a fight (see game/fightLink.js): copying a #watch= replay or #play= challenge
// link, and opening one from the page's address.

import { encodeFight, decodeFight, replayOutcome, fightUrl, linkIn, MAX_LINK_CODE } from './game/fightLink.js';
import { sfx } from './audio/sfx.js';
import { track, shareEvent } from './stats.js';
import { copyText } from './ui/copyBox.js';

/**
 * `watch(rec, { link })` shows a fight's replay, `play(rec, theirs)` starts it as a challenge,
 * `touch()` says whether the last pointer was a finger and `idle()` whether a link pasted
 * into the address bar may open now (from the title or camp).
 */
export function createLinks({ hud, touch, watch, play, idle }) {
  /**
   * A link that replays `f` for anyone who opens it: the share sheet on a phone, else the
   * clipboard. `button` says Copied for a moment.
   */
  async function copy(f, button, kind = 'watch') {
    if (!f?.check) return;
    sfx.ui();
    const label = button.textContent;
    try {
      const code = await encodeFight(f);
      if (code.length > MAX_LINK_CODE) {
        hud.toast('This fight is too long to fit in a link.');
        return;
      }
      const url = fightUrl(location.href, code, kind);
      if (touch() && navigator.share) {
        await navigator.share({ url, title: kind === 'play' ? 'Crypt Skirmish challenge' : 'Crypt Skirmish replay' });
        track(...shareEvent(kind === 'play' ? 'challenge' : 'replay', 'share'));
        return;
      }
      if (await copyText(url, { button, label, what: kind === 'play' ? 'challenge link' : 'replay link' })) {
        track(...shareEvent(kind === 'play' ? 'challenge' : 'replay', 'copy'));
      }
    } catch (err) {
      if (err?.name !== 'AbortError') hud.toast('Couldn’t copy the link here.');
    }
  }

  const clearHash = () => {
    if (linkIn(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  };

  /** Opened from a #watch= link: check the fight still plays out the same, then show it. */
  async function watchLink(code) {
    const f = await decodeFight(code);
    const out = f && replayOutcome(f);
    if (!out) {
      clearHash();
      hud.toast(f ? 'This replay was made with another version of the game, so it can’t be shown.' : 'This replay link is broken.');
      return;
    }
    watch({ ...f, rounds: out.rounds }, { link: true }); // the rounds, for Play it yourself
  }

  /**
   * Opened from a #play= link: a challenge. Check the fight still plays out the same (which
   * also tells its rounds), then go straight into it; how it went shows only at the end.
   */
  async function playLink(code) {
    const f = await decodeFight(code);
    const out = f && replayOutcome(f);
    clearHash(); // a reload shows the title
    if (!out) {
      hud.toast(f ? 'This challenge was made with another version of the game, so it can’t be played.' : 'This challenge link is broken.');
      return;
    }
    play({ ...f, rounds: out.rounds }, { result: f.result, rounds: out.rounds });
  }

  /** The page's #watch= or #play= link, if it has one. */
  function open(hash) {
    const l = linkIn(hash);
    if (l?.kind === 'watch') watchLink(l.code);
    else if (l?.kind === 'play') playLink(l.code);
  }

  // A link pasted into a tab that already has the game open.
  window.addEventListener('hashchange', () => {
    if (!linkIn(location.hash) || !idle()) return;
    open(location.hash);
  });

  return { copy, open, clearHash };
}
