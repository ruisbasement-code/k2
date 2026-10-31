// Every key in one list, shown in the controls menu (Esc). Add new keys here so
// they show up in the menu; the bindings themselves are in main.js and input.js.

export const CONTROLS = [
  ['Move', [
    [['W', 'A', 'S', 'D'], 'Move'],
    [['Shift'], 'Push the pace'],
    [['Space'], 'Self-arrest (hold)'],
    [['C'], 'Clip into / unclip from a fixed rope'],
    [['E'], 'Place an ice screw or snow picket (rope needed)'],
    [['I'], 'Draw / stow the ice axe'],
    [['Click'], 'Swing the axe on a steep wall (S + click to climb down)'],
    [['X'], 'Probe for hidden crevasses'],
  ]],
  ['Gear', [
    [['Tab'], 'Inventory'],
    [['1', '9'], 'Hotbar: hold or use what\'s in that slot'],
    [['G'], 'Gear up at Base Camp · restock at a camp · strike your tent'],
    [['J'], 'Hold the Wympr GPS'],
    [['U'], 'Hold the vitals monitor'],
    [['M'], 'Hold the map'],
    [['L'], 'Headlamp: off, on, high beam, red'],
  ]],
  ['Survive', [
    [['Z'], 'Sleep in a tent · pitch a tent, dig a cave or bivouac'],
    [['K'], 'Cook and melt snow in a tent'],
    [['B'], 'Eat a snack bar'],
    [['H'], 'Drink'],
    [['O'], 'Oxygen flow'],
    [['P'], 'Take dexamethasone'],
    [['Y'], 'Turnaround time'],
    [['R'], 'Respawn at Base Camp, after dying'],
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
      <div class="menu-buttons"><button id="menu-mute" class="ghost">${this.isMuted() ? 'Sound off' : 'Sound on'}</button><button id="menu-resume">Resume</button></div></div>`;
    this.el.hidden = false;
    this.el.querySelector('#menu-mute').onclick = () => { this.onMute(); this.show(); };
    this.el.querySelector('#menu-resume').onclick = () => this.hide();
  }

  hide() {
    this.el.hidden = true;
    this.onClose?.();
  }
}
