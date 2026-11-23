// input.js — keyboard + mouse singleton for ISLA BRASA 3D.
// Edge-trigger helpers: call input.update() once per frame (main.js does this
// at the start of the loop). `pressed(code)` is true only on the frame the key
// went down; `down(code)` is true while held. Mouse drag deltas accumulate
// between frames and are consumed by update() / consumeDrag().
export const input = {
  keys: new Set(),
  _prevKeys: new Set(),
  _justPressed: new Set(),
  _justReleased: new Set(),

  mouse: {
    x: 0,
    y: 0,
    down: false, // left button held
    clicked: false, // left button pressed this frame (edge)
    rightDown: false,
    dragDX: 0, // accumulated pointer movement while dragging (px)
    dragDY: 0,
    wheelDelta: 0,
  },

  // --- queries -------------------------------------------------------------
  down(code) { return this.keys.has(code); },
  pressed(code) { return this._justPressed.has(code); },
  released(code) { return this._justReleased.has(code); },

  // WASD / action conveniences (accepts KeyboardEvent.code values).
  get moveForward() { return this.down('KeyW') || this.down('ArrowUp'); },
  get moveBack() { return this.down('KeyS') || this.down('ArrowDown'); },
  get moveLeft() { return this.down('KeyA') || this.down('ArrowLeft'); },
  get moveRight() { return this.down('KeyD') || this.down('ArrowRight'); },
  get run() { return this.down('ShiftLeft') || this.down('ShiftRight'); },
  get jump() { return this.pressed('Space'); },

  // --- per-frame bookkeeping (called by main.js) ---------------------------
  // IMPORTANT: call update() at the END of the frame, after all consumers
  // have read pressed()/clicked()/drag deltas. Edge flags are set by the
  // event handlers between frames; clearing them here (end of frame) means
  // a key pressed during frame N is visible throughout frame N+1's logic
  // and cleared before frame N+2. Calling this at the START of a frame
  // would discard the edge before anyone reads it.
  update() {
    this._justPressed.clear();
    this._justReleased.clear();
    // Edge detection is done in the event handlers (they compare against
    // _prevKeys), so update() only resets the mouse edge flags / drag deltas.
    this.mouse.clicked = false;
    this.mouse.dragDX = 0;
    this.mouse.dragDY = 0;
    this.mouse.wheelDelta = 0;
    this._prevKeys = new Set(this.keys);
  },

  consumeDrag() {
    const d = { dx: this.mouse.dragDX, dy: this.mouse.dragDY };
    this.mouse.dragDX = 0;
    this.mouse.dragDY = 0;
    return d;
  },

  // --- wiring ---------------------------------------------------------------
  attach(target = window) {
    const self = this;
    target.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (!self.keys.has(e.code)) self._justPressed.add(e.code);
      self.keys.add(e.code);
      // Prevent page scroll / button activation for game keys.
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) {
        e.preventDefault();
      }
    });
    target.addEventListener('keyup', (e) => {
      self.keys.delete(e.code);
      self._justReleased.add(e.code);
    });
    target.addEventListener('blur', () => {
      self.keys.clear();
      self.mouse.down = false;
      self.mouse.rightDown = false;
    });
    target.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        self.mouse.down = true;
        self.mouse.clicked = true;
      }
      if (e.button === 2) self.mouse.rightDown = true;
      self.mouse.x = e.clientX;
      self.mouse.y = e.clientY;
    });
    target.addEventListener('mouseup', (e) => {
      if (e.button === 0) self.mouse.down = false;
      if (e.button === 2) self.mouse.rightDown = false;
    });
    target.addEventListener('mousemove', (e) => {
      const dx = e.clientX - self.mouse.x;
      const dy = e.clientY - self.mouse.y;
      self.mouse.x = e.clientX;
      self.mouse.y = e.clientY;
      if (self.mouse.down || self.mouse.rightDown) {
        self.mouse.dragDX += dx;
        self.mouse.dragDY += dy;
      }
    });
    target.addEventListener('wheel', (e) => { self.mouse.wheelDelta += e.deltaY; }, { passive: true });
    target.addEventListener('contextmenu', (e) => {
      // Only suppress the menu over the game canvas, not over overlays.
      if (e.target && e.target.tagName === 'CANVAS') e.preventDefault();
    });
  },
};

export default input;
