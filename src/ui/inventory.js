// The pack (Tab): what you carry, how full and heavy it is. Click a device to
// hold it, a consumable to use it. At Base Camp the gear store opens beside it
// (G) for gearing up: pick a pack, gear and supplies within the room you have.

import { GEAR, PACKS, EXTRAS, CONSUMABLE_LITRES } from '../sim/gear.js';
import { tuning } from '../sim/paceModel.js';

export const DEVICES = ['gps', 'monitor', 'map'];

const SUPPLIES = [
  ['snack', 'Snack bars', 'B'],
  ['meal', 'Meals', ''],
  ['water', 'Water', 'H'],
  ['gas', 'Gas', ''],
  ['oxygen', 'Oxygen', 'O'],
  ['dex', 'Dex', 'P'],
  ['firstaid', 'First aid', ''],
  ['warmers', 'Hand warmers', ''],
];

export class Inventory {
  /**
   * @param actions {hold(id), use(item)} called when a tile is clicked.
   */
  constructor(el, expedition, actions) {
    this.el = el;
    this.ex = expedition;
    this.actions = actions;
    this.store = false;
    el.addEventListener('click', (e) => this._click(e));
  }

  get open() {
    return !this.el.hidden;
  }

  show(store = false) {
    this.store = store;
    this.el.hidden = false;
    this.render();
  }

  hide() {
    this.el.hidden = true;
    this.onClose?.();
  }

  _count(item) {
    const p = this.ex.pack;
    if (item in EXTRAS) return p.extra[item];
    if (item === 'water') return p.water;
    return p.count(item);
  }

  render(note = '') {
    if (this.el.hidden) return;
    const ex = this.ex;
    const p = ex.pack;
    const held = this.actions.held();
    const used = p.litres, cap = p.capacity;
    const full = Math.min(used / cap, 1);
    const gearTiles = [...p.gear].sort((a, b) => order(a) - order(b)).map((id) => {
      const g = GEAR[id];
      const dev = DEVICES.includes(id);
      const isHeld = held === id;
      return `<button class="tile${dev ? ' dev' : ''}${isHeld ? ' on' : ''}" data-hold="${dev ? id : ''}" ${dev ? '' : 'tabindex="-1"'}>
        <b>${g.label}</b><small>${dev ? (isHeld ? 'In hand' : `Hold · ${{ gps: 'J', monitor: 'U', map: 'M' }[id]}`) : `${g.kg} kg`}</small></button>`;
    }).join('');
    const supplyTiles = SUPPLIES.map(([id, label, key]) => {
      const n = this._count(id);
      if (!n) return '';
      const shown = id === 'water' ? `${n.toFixed(1)} L` : id === 'gas' ? `${p.gasBrews} brews` : n;
      return `<button class="tile use" data-use="${id}"><b>${label}</b><small>${shown}${key ? ` · ${key}` : ''}</small></button>`;
    }).join('');
    const pack = `<div class="inv-col">
      <div class="inv-head"><h2>${PACKS[p.size].label}</h2><span>${p.kg.toFixed(1)} kg</span></div>
      <div class="cap"><div style="width:${(full * 100).toFixed(1)}%" class="${used > cap - 2 ? 'full' : ''}"></div></div>
      <div class="cap-text">${used.toFixed(1)} / ${cap} L</div>
      <div class="tiles">${gearTiles || '<p class="empty">No gear. Gear up at Base Camp.</p>'}</div>
      <div class="tiles">${supplyTiles}</div>
    </div>`;
    let store = '';
    if (this.store) {
      const groups = {};
      for (const id of ex.available()) (groups[GEAR[id].group] ??= []).push(id);
      const packs = ex.packs().map((id) => `<button class="chip${p.size === id ? ' on' : ''}" data-pack="${id}">${PACKS[id].label}</button>`).join('');
      store = `<div class="inv-col store">
        <div class="inv-head"><h2>Base Camp store</h2>${ex.unlocked ? '<span class="gold">Summit gear</span>' : ''}</div>
        <div class="chips">${packs}</div>
        ${Object.entries(groups).map(([name, ids]) => `<h3>${name}</h3><div class="rows">${ids.map((id) => {
          const g = GEAR[id];
          const has = p.gear.has(id);
          const fits = has || ex.fits(id);
          return `<button class="row${has ? ' on' : ''}${fits ? '' : ' nofit'}${g.unlock ? ' gold' : ''}" data-gear="${id}" title="${g.note}">
            <span class="check"></span><span class="name">${g.label}<small>${g.note}</small></span><span class="num">${g.kg} kg · ${g.litres} L</span></button>`;
        }).join('')}</div>`).join('')}
        <h3>Supplies</h3><div class="rows">${SUPPLIES.map(([id, label]) => {
          const n = this._count(id);
          const shown = id === 'water' ? `${n.toFixed(1)} L` : n;
          return `<div class="row step"><span class="name">${label}<small>${CONSUMABLE_LITRES[id]} L each</small></span>
            <span class="stepper"><button data-adj="${id}" data-n="-1">−</button><b>${shown}</b><button data-adj="${id}" data-n="1">+</button></span></div>`;
        }).join('')}</div>
        <div class="inv-foot"><span class="note">${note}</span><button id="set-off">Set off</button></div>
      </div>`;
    }
    this.el.innerHTML = `<div class="inv${this.store ? ' wide' : ''}">${pack}${store}</div>`;
  }

  _click(e) {
    const b = e.target.closest('button');
    if (!b) {
      if (e.target === this.el) this.hide();
      return;
    }
    const ex = this.ex;
    let note = '';
    if (b.id === 'set-off') return this.hide();
    if (b.dataset.hold) this.actions.hold(b.dataset.hold);
    else if (b.dataset.use) this.actions.use(b.dataset.use);
    else if (b.dataset.gear) { if (!ex.toggle(b.dataset.gear)) note = 'No room in the pack.'; }
    else if (b.dataset.pack) { if (!ex.setPack(b.dataset.pack)) note = 'Too much to fit in that pack.'; }
    else if (b.dataset.adj) {
      const item = b.dataset.adj;
      const n = +b.dataset.n;
      if (item === 'water' && n > 0 && ex.pack.water >= tuning.pack.water.max_l) note = `Bottles hold ${tuning.pack.water.max_l} L.`;
      else if (!ex.adjust(item, n)) note = 'No room in the pack.';
    }
    this.render(note);
  }
}

const ORDER = Object.keys(GEAR);
const order = (id) => ORDER.indexOf(id);
