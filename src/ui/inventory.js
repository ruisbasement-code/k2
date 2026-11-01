// The pack (Tab): what you carry, how full and heavy it is. Click a device to
// hold it, a consumable to use it. At Base Camp the gear store opens beside it
// (G) for gearing up: pick a pack, gear and supplies within the room you have.

import { GEAR, PACKS, EXTRAS, CONSUMABLE_LITRES } from '../sim/gear.js';
import { tuning } from '../sim/paceModel.js';
import { icon } from './icons.js';

export const DEVICES = ['gps', 'monitor', 'map'];

/** Signalling gear: used from the hotbar or the pack, even lying collapsed. */
export const SIGNALS = ['flares', 'strobe', 'whistle'];

/** Hotbar order: what you'd reach for, first nine you carry get keys 1 to 9. */
const HOTBAR = ['gps', 'monitor', 'map', 'axe', 'poles', 'snack', 'water', 'oxygen', 'firstaid', 'flares', 'strobe', 'whistle', 'dex', 'warmers', 'radio'];

/** The items on the hotbar right now, [{id, label, count}]. Collapsed, the signals come first. */
export function hotbarItems(climber) {
  const p = climber.pack;
  const out = [];
  const order = climber.collapsed ? [...SIGNALS, ...HOTBAR.filter((id) => !SIGNALS.includes(id))] : HOTBAR;
  for (const id of order) {
    if (id === 'axe') { if (climber.axe.have) out.push({ id: p.gear.has('axe_tech') ? 'axe_tech' : 'axe', label: 'Ice axe' }); continue; }
    if (GEAR[id]) { if (p.gear.has(id) && id !== 'radio') out.push({ id, label: GEAR[id].label }); continue; }
    const n = id in EXTRAS ? p.extra[id] : id === 'water' ? p.water : p.count(id);
    if (n > 0) out.push({ id, label: SUPPLY_LABEL[id], count: id === 'water' ? `${n.toFixed(1)}L` : n });
  }
  return out.slice(0, 9);
}

/** Packing grid: columns, and the shape (w × h cells) an item takes. */
const COLS = { pack45: 9, pack70: 10 };
const SHAPES = { tent: [3, 3], down_suit: [4, 2], rope: [3, 2], tent_ul: [3, 2], oxygen: [1, 5], shovel: [3, 1], crampons: [3, 1], stove: [2, 1] };
function shapeFor(id, litres) {
  if (SHAPES[id]) return SHAPES[id];
  const n = Math.max(1, Math.ceil(litres - 0.05));
  if (n <= 3) return [n, 1];
  return [3, Math.ceil(n / 3)];
}

/** Lay pack items out on the grid, biggest first, first fit. Returns placed items and rows used. */
function layout(items, cols, rows) {
  const grid = [];
  const free = (x, y, w, h) => {
    if (x + w > cols) return false;
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (grid[j]?.[i]) return false;
    return true;
  };
  const placed = [];
  for (const it of [...items].sort((a, b) => b.w * b.h - a.w * a.h)) {
    let done = false;
    for (let y = 0; !done; y++) {
      for (let x = 0; x < cols && !done; x++) {
        if (!free(x, y, it.w, it.h)) continue;
        for (let j = y; j < y + it.h; j++) { grid[j] ??= []; for (let i = x; i < x + it.w; i++) grid[j][i] = true; }
        placed.push({ ...it, x, y });
        done = true;
      }
    }
  }
  return { placed, rows: Math.max(rows, grid.length) };
}

const SUPPLY_LABEL = { snack: 'Snack bars', meal: 'Meals', water: 'Water', gas: 'Gas', oxygen: 'Oxygen', dex: 'Dex', firstaid: 'First aid', warmers: 'Hand warmers', flares: 'Signal flares' };

const SUPPLIES = [
  ['snack', 'Snack bars', 'B'],
  ['meal', 'Meals', ''],
  ['water', 'Water', 'H'],
  ['gas', 'Gas', ''],
  ['oxygen', 'Oxygen', 'O'],
  ['dex', 'Dex', 'P'],
  ['firstaid', 'First aid', ''],
  ['warmers', 'Hand warmers', ''],
  ['flares', 'Signal flares', ''],
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
    const slot = (id, where) => {
      const g = id && GEAR[id];
      if (!g) return `<div class="slot empty"><span class="where">${where}</span></div>`;
      const dev = DEVICES.includes(id);
      const use = SIGNALS.includes(id) ? `data-use="${id}"` : '';
      return `<button class="slot g-${g.group.toLowerCase()}${held === id ? ' on' : ''}" ${dev ? `data-hold="${id}"` : use} ${this.store ? `data-gear="${id}"` : ''} title="${g.label}: ${g.note}">
        ${icon(id)}<span class="where">${held === id ? 'in hand' : where}</span></button>`;
    };
    const wornId = (w) => [...p.gear].find((id) => GEAR[id]?.where === w);
    const pockets = [...p.gear].filter((id) => GEAR[id]?.where === 'pocket');
    while (pockets.length < 4) pockets.push(null);
    const worn = `<div class="worn">
      <div class="sec"><h3>Worn</h3><div class="slots">${slot(wornId('head'), 'Head')}${slot(wornId('body'), 'Body')}${slot(wornId('feet'), 'Feet')}${slot(wornId('axe'), 'Axe')}</div></div>
      <div class="sec"><h3>Pockets</h3><div class="slots">${pockets.map((id, i) => slot(id, ['J', 'U', 'M', ''][DEVICES.indexOf(id)] ?? '')).join('')}</div></div>
    </div>`;
    // The pack: each item a block sized by the room it takes.
    const items = [];
    for (const id of p.gear) {
      const g = GEAR[id];
      if (g.where) continue;
      const [w, h] = shapeFor(id, g.litres);
      items.push({ id, w, h, label: g.label, cls: `g-${g.group.toLowerCase()}`, attr: this.store ? `data-gear="${id}"` : '', title: `${g.label}: ${g.note}` });
    }
    for (const [id, label] of SUPPLIES) {
      const n = this._count(id);
      if (!n) continue;
      if (id === 'oxygen') {
        p.bottles.forEach((l, i) => items.push({ id, w: 1, h: 5, label: 'O₂', count: `${Math.round((l / tuning.pack.oxygen.litres) * 100)}%`, cls: 'g-supply', attr: `data-use="oxygen"`, title: 'Oxygen bottle', key: i }));
        continue;
      }
      const litres = id === 'water' ? n * CONSUMABLE_LITRES.water : n * CONSUMABLE_LITRES[id];
      const [w, h] = shapeFor(id, litres);
      const count = id === 'water' ? `${n.toFixed(1)} L` : id === 'gas' ? `${p.gasBrews}` : `×${n}`;
      items.push({ id, w, h, label, count, cls: id === 'flares' ? 'g-signals' : 'g-supply', attr: `data-use="${id}"`, title: label });
    }
    const cols = COLS[p.size] ?? 9;
    const rows = Math.ceil(cap / cols);
    const { placed, rows: usedRows } = layout(items, cols, rows);
    const cells = Array.from({ length: cols * usedRows }, (_, i) => {
      const r = Math.floor(i / cols), c = i % cols;
      return `<i class="${r >= rows ? 'over' : ''}" style="grid-column:${c + 1};grid-row:${r + 1}"></i>`;
    }).join('');
    const blocks = placed.map((it) => `<button class="item ${it.cls}" ${it.attr} title="${it.title}" style="grid-column:${it.x + 1} / span ${it.w};grid-row:${it.y + 1} / span ${it.h}">
      ${icon(it.id)}${it.w * it.h > 2 ? `<span class="nm">${it.label}</span>` : ''}${it.count ? `<span class="ct">${it.count}</span>` : ''}</button>`).join('');
    const pack = `<div class="inv-col pack">
      <div class="inv-head"><h2>${PACKS[p.size].label}</h2><span class="kg">${p.kg.toFixed(1)} kg</span></div>
      ${worn}
      <div class="sec"><h3>Backpack <span class="cap-text">${used.toFixed(1)} / ${cap} L</span></h3>
        <div class="cap"><div style="width:${(full * 100).toFixed(1)}%" class="${used > cap - 2 ? 'full' : ''}"></div></div>
        <div class="grid" style="--cols:${cols};--rows:${usedRows}"><div class="cells">${cells}</div>${blocks}</div></div>
      ${p.gear.size ? '' : '<p class="empty">No gear yet. Gear up at Base Camp (G).</p>'}
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
            <span class="ri g-${g.group.toLowerCase()}">${icon(id)}</span><span class="name">${g.label}<small>${g.note}</small></span><span class="num">${g.kg} kg${g.where ? '' : ` · ${g.litres} L`}</span></button>`;
        }).join('')}</div>`).join('')}
        <h3>Supplies</h3><div class="rows">${SUPPLIES.map(([id, label]) => {
          const n = this._count(id);
          const shown = id === 'water' ? `${n.toFixed(1)} L` : n;
          return `<div class="row step"><span class="ri g-supply">${icon(id)}</span><span class="name">${label}<small>${CONSUMABLE_LITRES[id]} L each</small></span>
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
    if (b.dataset.gear) { if (!ex.toggle(b.dataset.gear)) note = 'No room in the pack.'; }
    else if (b.dataset.hold) this.actions.hold(b.dataset.hold);
    else if (b.dataset.use) this.actions.use(b.dataset.use);
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

