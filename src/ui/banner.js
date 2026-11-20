// The end-of-fight banner: room cleared, defeat, the won campaign with its summary, or a
// daily, weekly or linked fight's result; with the recap, achievements unlocked, Copy result
// and Save image. The Watch, link and New Game+ buttons are wired up in main.js.

import { saveRunCard } from './runCard.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class EndBanner {
  /** `toast(text)` explains a failure; `touch()` says whether the last pointer was a finger. */
  constructor({ toast, touch }) {
    this.toast = toast;
    this.touch = touch;
    $('#share').addEventListener('click', () => this.share());
    $('#save-card').addEventListener('click', () => this.saveCard());
  }

  /** End-of-fight banner. `final`: the last room of the campaign. */
  show(result, { round, level, final, xp, outro = '', longRest = false, summary = null, awards = [], daily = null, challenge = null, share = null, recap = null, win = null, replay = false, ngplus = false }) {
    this.renderSummary(summary);
    this.renderRecap(recap, win);
    this.cardSummary = summary;
    $('#save-card').hidden = !summary;
    $('#save-card').textContent = 'Save image';
    $('#watch').hidden = !replay;
    $('#watch').textContent = 'Watch replay';
    $('#copy-link').hidden = !replay;
    $('#copy-link').textContent = 'Copy replay link';
    $('#copy-challenge').hidden = !replay;
    $('#copy-challenge').textContent = 'Copy challenge link';
    $('#watch-theirs').hidden = !challenge; // the link's fight, once yours is done
    $('#ngplus').hidden = !ngplus;
    this.renderAwards(awards);
    const rounds = `${round} round${round === 1 ? '' : 's'}`;
    const won = result === 'victory';
    const rest = longRest
      ? 'takes a long rest before going deeper (full HP and spell slots)'
      : 'catches its breath (short rest: regain half your missing HP)';
    $('#banner-title').textContent = won ? (final ? 'Victory' : 'Room cleared') : 'Defeat';
    $('#banner-emblem').hidden = !(won && final); // the skull laughs there (victorySkull in main.js)
    $('#banner-text').textContent = won
      ? final
        ? summary ? outro : `${outro} Won after ${rounds}. Well fought! (+${xp} XP)`
        : `${level} is quiet after ${rounds}. The party shares ${xp} XP and ${rest}.`
      : `Your party has fallen in ${level}. Try the room again as you entered it, or go back to the map and pick another way.`;
    $('#next').hidden = !won || final;
    $('#to-map').hidden = won;
    $('#restart').textContent = won ? 'New campaign' : 'Try again';
    $('#restart').hidden = won && !final;
    $('#to-map').textContent = 'Back to the map';
    this.setShare(share);
    if (daily) this.dailyBanner(daily, level);
    if (challenge) this.challengeBanner(challenge);
    $('#banner').dataset.result = result;
    $('#banner').hidden = false;
    // Keyboard and screen reader users land on the result; Tab reaches its buttons. (Not a
    // button itself, so a key still held from the last move can't press one.)
    $('#banner .card').focus({ preventScroll: true });
  }

  /**
   * The daily crypt's ending (or the weekly elite crypt's, `d.weekly`): the result, the day's
   * or week's best and the streak; try again or leave.
   */
  dailyBanner(d, level) {
    const rounds = (n) => `${n} round${n === 1 ? '' : 's'}`;
    const fell = (n) => (n === 0 ? 'nobody fell' : `${n} hero${n === 1 ? '' : 'es'} fell`);
    const best = d.best.won ? `won in ${rounds(d.best.rounds)}, ${fell(d.best.downed)}` : 'not won yet';
    const unit = d.weekly ? 'week' : 'day';
    $('#banner-title').textContent = d.won ? (d.weekly ? 'Weekly elite crypt won' : 'Daily crypt won') : 'Defeat';
    $('#banner-text').textContent = (d.won
      ? `${level} is quiet after ${rounds(d.rounds)}, and ${fell(d.downed)}.`
      : `Your party has fallen in ${level}. ${d.weekly ? 'This week’s' : 'Today’s'} crypt can be tried as often as you like.`)
      + ` Best ${d.weekly ? 'this week' : 'today'}: ${best} (try ${d.best.tries}).`
      + (d.streak > 0 ? ` Streak: ${d.streak} ${unit}${d.streak === 1 ? '' : 's'}.` : '');
    $('#next').hidden = true;
    $('#restart').hidden = false;
    $('#restart').textContent = 'Try again';
    $('#to-map').hidden = false;
    $('#to-map').textContent = 'Back to the title';
    this.setShare(d.share);
  }

  /** A linked fight played yourself: how it went next to the link's ({ title, text }); try again or leave. */
  challengeBanner({ title, text }) {
    $('#banner-title').textContent = title;
    $('#banner-text').textContent = text;
    $('#watch').textContent = 'Watch yours'; // next to Watch theirs
    $('#next').hidden = true;
    $('#restart').hidden = false;
    $('#restart').textContent = 'Try again';
    $('#to-map').hidden = false;
    $('#to-map').textContent = 'Back to the title';
    this.setShare(null);
  }

  /** The banner's Copy result button, for a won daily or campaign. */
  setShare(text) {
    this.shareText = text || null;
    $('#share').hidden = !this.shareText;
    $('#share').textContent = 'Copy result';
  }

  /** Copy the won daily's text, or hand it to the phone's share sheet. */
  async share() {
    const text = this.shareText;
    if (!text) return;
    const btn = $('#share');
    try {
      if (this.touch() && navigator.share) {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = 'Copy result'; }, 2000);
    } catch (err) {
      if (err?.name === 'AbortError') return; // the share sheet was closed
      this.toast('Couldn’t copy the result here.');
    }
  }

  /** The won campaign as a picture (see runCard.js): a download, or the share sheet on a phone. */
  async saveCard() {
    if (!this.cardSummary) return;
    const btn = $('#save-card');
    btn.disabled = true;
    try {
      const done = await saveRunCard(this.cardSummary, { touch: this.touch() });
      if (done !== 'cancelled') {
        btn.textContent = done === 'shared' ? 'Shared' : 'Saved';
        setTimeout(() => { btn.textContent = 'Save image'; }, 2000);
      }
    } catch {
      this.toast('Couldn’t save the image here.');
    } finally {
      btn.disabled = false;
    }
  }

  /**
   * The fight in a few lines (see game/recap.js). Lost: how each hero fell, then the foes.
   * Won: who led the way, the closest call, who fell and the potions drunk.
   */
  renderRecap(recap, win = null) {
    const el = $('#banner-recap');
    el.classList.toggle('won', !!win);
    if (win) {
      const lines = [['recap-best', win.best], ['recap-closest', win.closest], ['recap-fell', win.fell], ['recap-potions', win.potions]].filter(([, l]) => l);
      el.hidden = !win.best && !win.closest && !win.fell; // potions alone aren't a story
      el.innerHTML = el.hidden ? '' : `<h2>How it went</h2>${lines.map(([cls, l]) => `<p class="${cls}">${esc(l)}</p>`).join('')}`;
      return;
    }
    const lines = recap ? [['recap-worst', recap.worst], ['recap-left', recap.left]].filter(([, l]) => l) : [];
    el.hidden = !recap || (!recap.falls.length && !lines.length);
    el.innerHTML = el.hidden ? '' : `<h2>How it went</h2>`
      + (recap.falls.length ? `<ol>${recap.falls.map((f) => `<li>${esc(f)}</li>`).join('')}</ol>` : '')
      + lines.map(([cls, l]) => `<p class="${cls}">${esc(l)}</p>`).join('')
      + (recap.tip ? `<p class="recap-tip"><b>Next time:</b> ${esc(recap.tip)}</p>` : '');
  }

  /** Achievements this fight unlocked, as gold chips under the banner text. */
  renderAwards(awards) {
    const el = $('#banner-awards');
    el.hidden = awards.length === 0;
    el.innerHTML = awards.map((a) => `<li title="${esc(a.desc)}"><span class="award-mark" aria-hidden="true">★</span>`
      + `<span><b>${esc(a.name)}</b><small>${esc(a.desc)}</small></span></li>`).join('');
    el.setAttribute('aria-label', `Achievement${awards.length === 1 ? '' : 's'} unlocked`);
  }

  /** The run's ending: totals, then a row per hero with the column leaders in gold. */
  renderSummary(s) {
    const el = $('#banner-stats');
    $('#banner').classList.toggle('ending', !!s);
    el.hidden = !s;
    if (!s) {
      el.innerHTML = '';
      return;
    }
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const facts = [
      ['Difficulty', s.difficulty],
      ['Party level', s.level],
      ['Rooms won', s.won],
      ['Rounds', s.rounds],
      ['Fights lost', s.lost || 'None'],
      ['XP', s.xp],
    ];
    const cols = [
      ['damage', 'Damage'],
      ['kills', 'Kills'],
      ['crits', 'Crits'],
      ['healing', 'Healing'],
      ['downed', 'Downed'],
    ];
    const cell = (h, f) => `<td class="${h.best.includes(f) ? 'best' : ''}">${h[f]}</td>`;
    const top = (f) => s.heroes.filter((h) => h.best.includes(f)).map((h) => esc(h.name)).join(' & ');
    const honours = [
      top('damage') && `<b>${top('damage')}</b> dealt the most damage`,
      top('healing') && `<b>${top('healing')}</b> kept everyone standing`,
    ].filter(Boolean);
    const closing = s.heroes.every((h) => h.downed === 0) ? 'Nobody fell. Not once.'
      : !s.lost ? 'Not a single fight lost.'
        : `${plural(s.lost, 'fight')} lost along the way, but the crypt is quiet at last.`;
    el.innerHTML = `
      <dl class="run-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      ${s.eliteCount ? `<p class="run-elites"><b>${plural(s.eliteCount, 'elite')} slain:</b> ${s.elites.map((e) => `${e.count} ${esc(e.name)}`).join(', ')}</p>` : ''}
      <table class="run-heroes">
        <thead><tr><th>Hero</th>${cols.map(([, label]) => `<th>${label}</th>`).join('')}</tr></thead>
        <tbody>${s.heroes.map((h) => `<tr>
          <th scope="row"><b>${esc(h.name)}</b><small>${esc(h.cls)} · <span class="nowrap">Lv ${h.level}</span></small></th>
          ${cols.map(([f]) => cell(h, f)).join('')}
        </tr>`).join('')}</tbody>
      </table>
      <p class="run-honours">${[...honours, closing].join(' · ')}</p>`;
  }
}
