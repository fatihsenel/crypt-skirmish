// The pedlar's panel, opened from camp (Visit the pedlar) where he trades (game/shop.js): his
// potions and two pieces of gear to buy, and the pack's spare gear to sell him at half price.
// Built on first open, so neither it nor its styles weigh on the title.

import { Overlay } from './overlay.js';
import { announce } from './announce.js';
import { ITEMS } from '../game/items.js';
import { PRICES, stock, buyProblem, buy, sell, sellPrice } from '../game/shop.js';
import './shop.css';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const LINES = [
  'A hunched pedlar and his mule have followed you down. “Coin for comfort, friends?”',
  'The pedlar spreads a blanket by the fire. “Everything’s for sale. Even the mule, for the right price.”',
  'The pedlar counts your coins twice. “Deeper you go, dearer it gets. Danger money.”',
];

export class Shop {
  /**
   * `get()` is the campaign now; `set(state)` keeps a trade (saves it, redraws the camp).
   */
  constructor(get, set) {
    this.get = get;
    this.set = set;
    this.el = document.createElement('section');
    this.el.id = 'shop';
    this.el.className = 'overlay';
    this.el.hidden = true;
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-labelledby', 'shop-head');
    this.el.innerHTML = `<div class="overlay-card narrow">
      <header class="camp-head"><h2 id="shop-head">The Pedlar</h2><button type="button" class="quiet" data-close>Close</button></header>
      <p class="shop-line muted"></p><p class="shop-gold"></p>
      <h3 class="sub">For sale</h3><ul class="shop-list buy"></ul>
      <div class="shop-sell"><h3 class="sub">Sell from the pack</h3><ul class="shop-list sell"></ul></div>
    </div>`;
    document.body.append(this.el);
    this.panel = new Overlay(this.el);
    this.el.addEventListener('click', (ev) => this.onClick(ev));
  }

  open(opener) {
    this.el.querySelector('.shop-line').textContent = LINES[this.get().cleared.length % LINES.length];
    this.draw();
    this.panel.open(opener);
  }

  draw() {
    const state = this.get();
    this.el.querySelector('.shop-gold').innerHTML = `The party has <b class="gold">${state.gold ?? 0} gold</b>.`;
    this.el.querySelector('.buy').innerHTML = stock(state).map((id) => {
      const problem = buyProblem(state, id);
      return `<li><div><b class="loot">${esc(ITEMS[id].name)}</b><small>${esc(ITEMS[id].desc)}${id === 'potion' || ITEMS[id].kind === 'supply' ? ' Goes to whoever carries fewest.' : ITEMS[id].kind === 'scroll' ? ' Goes to a hero who can read it.' : ' Goes into the pack.'}</small></div>
        <button type="button" data-buy="${id}"${problem ? ` disabled data-hint="${esc(problem)}"` : ''}>Buy · ${PRICES[id]} gold</button></li>`;
    }).join('');
    const spare = state.pack.map((id, i) => [id, i]).filter(([id]) => sellPrice(id));
    this.el.querySelector('.shop-sell').hidden = !spare.length;
    this.el.querySelector('.sell').innerHTML = spare.map(([id, i]) => `<li><div><b class="loot">${esc(ITEMS[id].name)}</b><small>${esc(ITEMS[id].desc)}</small></div>
      <button type="button" data-sell="${i}">Sell · ${sellPrice(id)} gold</button></li>`).join('');
  }

  onClick(ev) {
    const b = ev.target.closest('button[data-buy], button[data-sell]');
    if (!b || b.disabled) return;
    const state = this.get();
    let next;
    let said;
    if (b.dataset.buy) {
      const id = b.dataset.buy;
      next = buy(state, id);
      said = `Bought ${ITEMS[id].name} for ${PRICES[id]} gold.`;
    } else {
      const id = state.pack[Number(b.dataset.sell)];
      next = sell(state, Number(b.dataset.sell));
      said = `Sold ${ITEMS[id].name} for ${sellPrice(id)} gold.`;
    }
    this.set(next);
    this.draw();
    announce(`${said} ${next.gold} gold left.`);
    // The pressed button may be gone: keep focus in the panel.
    (this.el.querySelector(b.dataset.buy ? `[data-buy="${b.dataset.buy}"]:not([disabled])` : '[data-sell]') ?? this.el.querySelector('[data-close]')).focus();
  }
}
