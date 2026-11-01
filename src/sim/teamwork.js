// Helping a teammate: what you can do for another climber standing next to you,
// what it takes out of your pack, and what it does when it reaches them. Plain
// data and pure functions: the helper's game takes the item and sends the help
// as a message; the other climber's game applies it with receiveHelp() and
// answers whether it took, so an item that couldn't be used is given back.

import { EXTRAS, CONSUMABLE_LITRES } from './gear.js';
import { tuning } from './paceModel.js';

/** How close you need to be to a teammate to help them, metres. */
export const HELP_RANGE = 3.5;
/** How much water you pour into their bottle, litres. */
export const GIVE_WATER_L = 0.5;

/** What each help is, as the menu says it. */
export const HELP = {
  revive: { label: 'Get them up', note: 'Rub them warm, get them on their feet' },
  firstaid: { label: 'First aid', note: `Patch them up: +${EXTRAS.firstaid.heal} health, uses a first-aid kit` },
  water: { label: 'Give water', note: `${GIVE_WATER_L} L from your bottle` },
  snack: { label: 'Give a snack bar' },
  dex: { label: 'Give dexamethasone' },
  oxygen: { label: 'Give an oxygen bottle' },
  warmers: { label: 'Give hand warmers' },
  kit: { label: 'Give a first-aid kit' },
  flares: { label: 'Give a flare' },
};

/**
 * What you can do for a teammate now, in the order the menu lists it.
 * @param pack your Pack
 * @param mate their last state: {health, maxHealth, collapsed, dead}
 * @returns [{act, label, note}]
 */
export function helpOptions(pack, mate) {
  if (!mate || mate.dead) return [];
  const out = [];
  const add = (act) => out.push({ act, ...HELP[act] });
  if (mate.collapsed) add('revive');
  if (pack.extra.firstaid > 0 && mate.health < mate.maxHealth - 1) add('firstaid');
  if (pack.water >= GIVE_WATER_L - 1e-6) add('water');
  if (pack.snack > 0) add('snack');
  if (pack.dex > 0) add('dex');
  // Keep the bottle on your own mask: you can hand over a spare.
  if (pack.bottles.length > 1) add('oxygen');
  if (pack.extra.warmers > 0) add('warmers');
  if (pack.extra.firstaid > 0) add('kit');
  if (pack.extra.flares > 0) add('flares');
  return out;
}

/** Take what a help needs out of your pack. Returns the message to send, or null. */
export function takeForHelp(pack, act) {
  const e = pack.extra;
  switch (act) {
    case 'revive': return { act };
    case 'firstaid': if (e.firstaid > 0) { e.firstaid--; return { act, heal: EXTRAS.firstaid.heal }; } return null;
    case 'kit': if (e.firstaid > 0) { e.firstaid--; return { act }; } return null;
    case 'warmers': if (e.warmers > 0) { e.warmers--; return { act }; } return null;
    case 'flares': if (e.flares > 0) { e.flares--; return { act }; } return null;
    case 'snack': if (pack.snack > 0) { pack.snack--; return { act }; } return null;
    case 'dex': if (pack.dex > 0) { pack.dex--; return { act }; } return null;
    case 'water': {
      const l = Math.min(GIVE_WATER_L, pack.water);
      if (l <= 0.01) return null;
      pack.water -= l;
      return { act, litres: l };
    }
    case 'oxygen': {
      if (pack.bottles.length < 2) return null;
      // The fullest spare, not the one on your mask.
      let best = 1;
      for (let i = 2; i < pack.bottles.length; i++) if (pack.bottles[i] > pack.bottles[best]) best = i;
      return { act, litres: pack.bottles.splice(best, 1)[0] };
    }
    default: return null;
  }
}

/** Put back what takeForHelp took, when the help didn't take on the other end. */
export function giveBack(pack, help) {
  const e = pack.extra;
  switch (help?.act) {
    case 'firstaid': case 'kit': e.firstaid++; break;
    case 'warmers': e.warmers++; break;
    case 'flares': e.flares++; break;
    case 'snack': pack.snack++; break;
    case 'dex': pack.dex++; break;
    case 'water': pack.water += help.litres ?? 0; break;
    case 'oxygen': pack.bottles.push(help.litres ?? tuning.pack.oxygen.litres); break;
    default: break;
  }
}

/** What a gift takes up in a pack, litres. */
function giftLitres(help) {
  const L = CONSUMABLE_LITRES;
  return { water: (help.litres ?? 0) * L.water, snack: L.snack, dex: L.dex, oxygen: L.oxygen, warmers: L.warmers, kit: L.firstaid, flares: L.flares }[help.act] ?? 0;
}

/**
 * Help from a teammate reaching you. Returns {ok, text}: ok false if it couldn't
 * be used (you were already up, already healed, or your pack is full), so the
 * helper gets the item back.
 * @param c your Climber
 * @param help the message takeForHelp made
 * @param by their name
 */
export function receiveHelp(c, help, by) {
  if (c.dead) return { ok: false, text: '' };
  const pack = c.pack;
  const fits = () => pack.litres + giftLitres(help) <= pack.capacity + 1e-6;
  const full = { ok: false, text: `${by} tried to give you something, but your pack is full` };
  switch (help?.act) {
    case 'revive':
      return c.revive(by) ? { ok: true, text: '' } : { ok: false, text: '' };
    case 'firstaid': {
      const before = c.health;
      c.health = Math.min(c.maxHealth, c.health + (help.heal ?? EXTRAS.firstaid.heal));
      const healed = Math.round(c.health - before);
      if (healed <= 0) return { ok: false, text: '' };
      return { ok: true, text: `${by} patched you up: +${healed} health` };
    }
    case 'water':
      if (!fits()) return full;
      pack.water += help.litres ?? 0;
      return { ok: true, text: `${by} gave you ${(help.litres ?? 0).toFixed(1)} L of water` };
    case 'oxygen':
      if (!fits()) return full;
      pack.bottles.push(help.litres ?? tuning.pack.oxygen.litres);
      return { ok: true, text: `${by} gave you an oxygen bottle` };
    case 'snack': case 'dex': case 'warmers': case 'kit': case 'flares': {
      if (!fits()) return full;
      if (help.act === 'snack') pack.snack++;
      else if (help.act === 'dex') pack.dex++;
      else pack.extra[help.act === 'kit' ? 'firstaid' : help.act]++;
      const what = { snack: 'a snack bar', dex: 'a dexamethasone tablet', warmers: 'hand warmers', kit: 'a first-aid kit', flares: 'a flare' }[help.act];
      return { ok: true, text: `${by} gave you ${what}` };
    }
    default:
      return { ok: false, text: '' };
  }
}

/** What the helper sees when help took, e.g. "You patched Ana up". */
export function helpedText(act, name) {
  return {
    revive: `You got ${name} back on their feet`,
    firstaid: `You patched ${name} up`,
    water: `You gave ${name} some water`,
    oxygen: `You gave ${name} an oxygen bottle`,
    snack: `You gave ${name} a snack bar`,
    dex: `You gave ${name} dexamethasone`,
    warmers: `You gave ${name} hand warmers`,
    kit: `You gave ${name} a first-aid kit`,
    flares: `You gave ${name} a flare`,
  }[act] ?? `You helped ${name}`;
}

/** The teammate nearest you within reach, from {id -> state}, or null. */
export function mateInReach(pos, mates, range = HELP_RANGE) {
  let best = null;
  let bd = range;
  for (const m of mates) {
    if (!m.state?.at || m.state.dead) continue;
    const [x, y, z] = m.state.at;
    const d = Math.hypot(x - pos.x, y - pos.y, z - pos.z);
    if (d <= bd) { bd = d; best = m; }
  }
  return best;
}
