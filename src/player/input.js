// Keyboard and mouse input. Key bindings live in one readable place.

export const BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  push: ['ShiftLeft', 'ShiftRight'],
  up: ['KeyE', 'Space'],
  down: ['KeyQ'],
  arrest: ['Space'],
};

export class Input {
  constructor(canvas) {
    this.keys = {};
    this.look = { dx: 0, dy: 0, zoom: 0 };
    this.handlers = {};
    addEventListener('keydown', (e) => {
      // Typing in a box (the chat, your name): not a game key.
      if (isTyping(e)) return;
      if (e.code === 'Space') e.preventDefault();
      if (!e.repeat) this.handlers[e.code]?.();
      this.keys[e.code] = true;
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    addEventListener('blur', () => { this.keys = {}; });
    canvas.addEventListener('mousedown', () => canvas.requestPointerLock?.());
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas) {
        this.look.dx += e.movementX;
        this.look.dy += e.movementY;
      }
    });
    canvas.addEventListener('wheel', (e) => {
      this.look.zoom += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
  }

  /** Run fn when a key is first pressed. */
  on(code, fn) {
    this.handlers[code] = fn;
  }

  held(action) {
    return BINDINGS[action].some((k) => this.keys[k]);
  }

  /** Movement for the climber: x right, y forward. */
  movement() {
    let x = (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0);
    let y = (this.held('forward') ? 1 : 0) - (this.held('back') ? 1 : 0);
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y, push: this.held('push'), up: this.held('up'), down: this.held('down'), arrest: this.held('arrest') };
  }

  /** Mouse movement and wheel since the last call. */
  takeLook() {
    const l = this.look;
    this.look = { dx: 0, dy: 0, zoom: 0 };
    return l;
  }
}

/** Whether a key went to a text box rather than the game. */
export function isTyping(e) {
  const t = e.target;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
