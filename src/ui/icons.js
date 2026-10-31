// Line icons for gear and supplies, drawn on a 24 × 24 grid with currentColor.

const P = {
  gps: '<rect x="7" y="3" width="10" height="18" rx="2"/><rect x="9" y="6" width="6" height="6" rx="1"/><path d="M10 15h4M10 18h4M12 3V1"/>',
  monitor: '<rect x="6" y="6" width="12" height="12" rx="4"/><path d="M9 6V3h6v3M9 18v3h6v-3M8 12h2l1-2 2 4 1-2h2"/>',
  map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
  radio: '<rect x="5" y="8" width="14" height="13" rx="2"/><path d="M8 8l8-6"/><circle cx="12" cy="14" r="3"/>',
  axe: '<path d="M12 3v18"/><path d="M5 5c3-1 5-1 7 0 2-1 5-1 8 1-3 0-5 1-8 1-2 0-4-1-7-2z"/>',
  crampons: '<path d="M4 10h16v3H4z"/><path d="M5 13l-1 4M9 13l-1 4M13 13l-1 4M17 13l-1 4M20 11l2-2"/>',
  rope: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="2"/>',
  screws: '<path d="M8 3h8v3H8zM12 6v15"/><path d="M9 9l6 2M9 12l6 2M9 15l6 2"/>',
  pickets: '<path d="M8 3v18l2-2V3zM14 3v18l2-2V3z"/>',
  poles: '<path d="M8 2v20M16 2v20M6 4h4M14 4h4M7 22l1-3 1 3M15 22l1-3 1 3"/>',
  probe: '<path d="M12 2v20M10 6h4M10 11h4M10 16h4"/>',
  tent: '<path d="M2 20L12 4l10 16z"/><path d="M12 4v16M9 20l3-5 3 5"/>',
  bivy: '<path d="M2 17c2-6 6-8 10-8s8 2 10 8z"/><path d="M6 15c1-2 2-3 4-3"/>',
  shovel: '<path d="M12 2v12"/><path d="M8 14h8l-1 6-3 2-3-2z"/><path d="M10 2h4"/>',
  stove: '<path d="M7 14h10v6H7z"/><path d="M5 14h14M9 11c0-2 2-2 2-4M13 11c0-2 2-2 2-4"/>',
  down_suit: '<path d="M8 3h8l4 6-3 2-1-3v13h-3v-7h-2v7H8V8l-1 3-3-2z"/>',
  gloves: '<path d="M7 21v-8l-2-3 2-1 2 2V4h3v7V5h3v7l2-3 2 1-3 6v5z"/>',
  goggles: '<rect x="3" y="8" width="18" height="8" rx="4"/><path d="M12 10v4"/>',
  snack: '<rect x="3" y="9" width="18" height="6" rx="1"/><path d="M6 9v6M18 9v6M9 12h6"/>',
  meal: '<path d="M6 4h12l-1 17H7z"/><path d="M6 8h12"/>',
  water: '<path d="M9 2h6v3l2 3v14H7V8l2-3z"/><path d="M7 13h10"/>',
  gas: '<path d="M7 8c0-2 2-3 5-3s5 1 5 3v12H7z"/><path d="M10 5V3h4v2"/>',
  oxygen: '<rect x="8" y="5" width="8" height="17" rx="4"/><path d="M10 5V2h4v3M12 2h4"/>',
  dex: '<rect x="4" y="9" width="16" height="6" rx="3"/><path d="M12 9v6"/>',
  firstaid: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M9 6V4h6v2M12 10v6M9 13h6"/>',
  warmers: '<rect x="6" y="5" width="12" height="14" rx="3"/><path d="M10 9c0 2 2 2 2 4s-2 2-2 4M14 9c0 2-2 2-2 4"/>',
};
P.axe_tech = P.axe;
P.crampons_pro = P.crampons;
P.tent_ul = P.tent;

export function icon(id) {
  return `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${P[id] ?? '<circle cx="12" cy="12" r="6"/>'}</svg>`;
}
