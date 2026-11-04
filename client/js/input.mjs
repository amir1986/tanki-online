// Keyboard + mouse input with pointer lock. Produces tank controls and fires named actions.
export const DEFAULT_BINDS = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  turretLeft: ['KeyZ', 'KeyQ'], turretRight: ['KeyX', 'KeyE'], fire: ['Space'], center: ['KeyC'],
  selfDestruct: ['Delete'], scoreboard: ['Tab'], chat: ['Enter'], teamChat: ['KeyT'], pause: ['Escape'], camera: ['KeyF'],
  supply1: ['Digit1'], supply2: ['Digit2'], supply3: ['Digit3'], supply4: ['Digit4'], supply5: ['Digit5'],
  flip: ['KeyR'], zoomIn: ['Equal'], zoomOut: ['Minus'],
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.binds = JSON.parse(JSON.stringify(DEFAULT_BINDS));
    this.mouse = { dx: 0, dy: 0, wheel: 0, left: false, right: false };
    this.locked = false;
    this.enabled = false;         // battle input active
    this.textFocus = false;       // typing in chat
    this.actions = new Map();     // name -> Set<fn>
    this.wantLock = false;

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.left = false; this.mouse.right = false; });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) { this.mouse.left = false; }
      this.fire('lockchange', this.locked);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.locked && this.wantLock) { this.requestLock(); }
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) this.mouse.right = true;
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { if (this.enabled) { this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); } }, { passive: false });
  }

  requestLock() {
    try { this.canvas.requestPointerLock?.(); } catch (e) { /* ignore */ }
  }
  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  onAction(name, fn) {
    if (!this.actions.has(name)) this.actions.set(name, new Set());
    this.actions.get(name).add(fn);
  }
  fire(name, arg) {
    const s = this.actions.get(name);
    if (s) for (const fn of s) fn(arg);
  }

  actionFor(code) {
    for (const [name, codes] of Object.entries(this.binds)) if (codes.includes(code)) return name;
    return null;
  }

  onKey(e, down) {
    const code = e.code;
    // typing in a menu text field (clan tag, nickname...) must never be eaten by key bindings
    const tgt = e.target;
    if (!this.textFocus && tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable)) return;
    if (this.textFocus) {
      if (down && code === 'Escape') { e.preventDefault(); this.fire('chatCancel'); }
      return;
    }
    if (down) this.keys.add(code); else this.keys.delete(code);
    const action = this.actionFor(code);
    if (action && ['scoreboard', 'chat', 'teamChat', 'pause', 'camera', 'selfDestruct', 'center', 'flip', 'zoomIn', 'zoomOut'].includes(action)) e.preventDefault();
    if (code === 'Tab') e.preventDefault();
    if (!this.enabled) {
      if (down && action === 'pause') this.fire('pause');
      return;
    }
    if (down && !e.repeat && action) {
      if (action.startsWith('supply')) this.fire('supply', +action.slice(6));
      else this.fire(action, true);
    }
    if (!down && action) this.fire(action + 'Up', false);
  }

  isDown(action) {
    const codes = this.binds[action] || [];
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  /** Current tank controls. */
  getControls() {
    let f = 0, t = 0, tt = 0;
    if (this.isDown('forward')) f += 1;
    if (this.isDown('back')) f -= 1;
    if (this.isDown('right')) t += 1;
    if (this.isDown('left')) t -= 1;
    if (this.isDown('turretRight')) tt += 1;
    if (this.isDown('turretLeft')) tt -= 1;
    const fire = this.isDown('fire') || (this.locked && this.mouse.left);
    return { f, t, tt, fire };
  }

  consumeMouse() {
    const m = { dx: this.mouse.dx, dy: this.mouse.dy, wheel: this.mouse.wheel };
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
    return m;
  }

  setBinds(binds) {
    this.binds = { ...DEFAULT_BINDS, ...binds };
  }
}

export const KEY_LABELS = {
  KeyW: 'W', KeyA: 'A', KeyS: 'S', KeyD: 'D', KeyZ: 'Z', KeyX: 'X', KeyQ: 'Q', KeyE: 'E', KeyC: 'C', KeyF: 'F', KeyR: 'R', KeyT: 'T',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space', Delete: 'Delete', Tab: 'Tab', Enter: 'Enter', Escape: 'Esc',
  Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4', Digit5: '5', Equal: '+', Minus: '-',
};
