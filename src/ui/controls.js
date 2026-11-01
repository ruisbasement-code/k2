// Every key in one list, shown in the controls menu (Esc). Add new keys here so
// they show up in the menu; the bindings themselves are in main.js and input.js.

export const CONTROLS = [
  ['Move', [
    [['W', 'A', 'S', 'D'], 'Move'],
    [['Shift'], 'Push the pace'],
    [['Space'], 'Self-arrest (hold, with the ice axe in hand)'],
    [['Q'], 'Catch your footing when it flashes up on steep ground, before the ring runs out'],
    [['C'], 'Clip into / unclip from a fixed rope (at an anchor: clip past it)'],
    [['E'], 'Place an ice screw or snow picket (rope needed)'],
    [['I'], 'Hold / stow the ice axe (needed on steep snow and ice)'],
    [['X'], 'Probe for hidden crevasses'],
  ]],
  ['Gear', [
    [['Tab'], 'Inventory'],
    [['1', '9'], 'Hotbar: hold or use what\'s in that slot (trekking poles: out / away; crampons: strap on / take off, on a ledge, gentle ground or the rope)'],
    [['G'], 'Gear up at Base Camp · restock at a camp · strike your tent'],
    [['J'], 'Hold the Wympr GPS'],
    [['U'], 'Hold the vitals monitor'],
    [['M'], 'Hold the map'],
    [['L'], 'Headlamp: off, on, high beam, red'],
    [['1', '9'], 'Signal flare, strobe or whistle from the hotbar: call for help, even collapsed'],
  ]],
  ['Survive', [
    [['Z'], 'Sleep in a tent · pitch a tent, dig a cave or bivouac'],
    [['K'], 'Cook and melt snow in a tent'],
    [['B'], 'Eat a snack bar'],
    [['H'], 'Drink'],
    [['O'], 'Oxygen flow'],
    [['P'], 'Take dexamethasone'],
    [['Y'], 'Turnaround time'],
    [['R'], 'Get up when stuck lying on steep ground · respawn after dying · give up when collapsed'],
  ]],
  ['View', [
    [['Mouse'], 'Look (click to capture)'],
    [['Wheel'], 'Zoom'],
    [['V'], 'First / third person'],
    [['T'], 'Time speed'],
  ]],
  ['Dev', [
    [['F'], 'Scout fly (E up, Q down)'],
    [['N'], 'Next weather'],
  ]],
];

/** The pause menu: every control, and the sound switch. */
export class ControlsMenu {
  constructor(el, { onMute, isMuted }) {
    this.el = el;
    this.onMute = onMute;
    this.isMuted = isMuted;
  }

  get open() {
    return !this.el.hidden;
  }

  show() {
    const groups = CONTROLS.map(([name, rows]) => `<section><h2>${name}</h2>${rows.map(([keys, label]) =>
      `<div class="ctl"><span>${keys.map((k) => `<kbd>${k}</kbd>`).join(keys.length === 2 && keys[0] === '1' ? '–' : '')}</span><span>${label}</span></div>`).join('')}</section>`).join('');
    this.el.innerHTML = `<div class="card panel"><h1>Paused</h1><div class="ctl-grid">${groups}</div>
      <div class="menu-buttons"><button id="menu-getup" class="ghost" title="Crawl to the nearest spot you can stand on (R)">Get up</button><button id="menu-mute" class="ghost">${this.isMuted() ? 'Sound off' : 'Sound on'}</button><button id="menu-resume">Resume</button></div></div>`;
    this.el.hidden = false;
    this.el.querySelector('#menu-mute').onclick = () => { this.onMute(); this.show(); };
    this.el.querySelector('#menu-resume').onclick = () => this.hide();
    this.el.querySelector('#menu-getup').onclick = () => { this.hide(); this.onGetUp?.(); };
  }

  hide() {
    this.el.hidden = true;
    this.onClose?.();
  }
}
