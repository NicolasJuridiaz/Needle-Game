/**
 * Keyboard / mouse / pointer-lock input. Keys are tracked by KeyboardEvent.code (physical position),
 * so WASD works on AZERTY (ZQSD) automatically; labels shown to the player come from the layout map.
 */

/** Codes the game consumes; their browser default is prevented while the game has focus. */
const GAME_CODES = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyQ', 'KeyR', 'KeyF', 'KeyT', 'KeyB', 'KeyO', 'KeyX', 'KeyM', 'KeyG', 'KeyC', 'KeyV',
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Space', 'ShiftLeft', 'ShiftRight', 'Tab',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ControlLeft',
]);

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  private mouseDown = [false, false, false];
  private mousePressed = [false, false, false];
  private mouseReleased = [false, false, false];
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  locked = false;
  private layout: Map<string, string> | null = null;
  /** Called when pointer lock is gained/lost. */
  onLockChange: ((locked: boolean) => void) | null = null;
  /** Suppress game input (e.g. while a text field in the UI has focus). */
  enabled = true;
  private cleanup: (() => void)[] = [];

  constructor(private readonly target: HTMLElement) {
    const on = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      window.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => window.removeEventListener(type, fn as EventListener, opts));
    };
    on('keydown', (e) => {
      if (!this.enabled) return;
      if (GAME_CODES.has(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    on('keyup', (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    on('blur', () => this.releaseAll());
    on('mousedown', (e) => {
      if (!this.enabled) return;
      if (e.button < 3) { this.mouseDown[e.button] = true; this.mousePressed[e.button] = true; }
    });
    on('mouseup', (e) => {
      if (e.button < 3) { this.mouseDown[e.button] = false; this.mouseReleased[e.button] = true; }
    });
    on('mousemove', (e) => {
      if (!this.locked) return;
      // Guard against the occasional huge spike some browsers emit when locking.
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    on('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    on('contextmenu', (e) => e.preventDefault());
    const lockChange = () => {
      this.locked = document.pointerLockElement === this.target;
      if (!this.locked) this.releaseAll();
      this.onLockChange?.(this.locked);
    };
    document.addEventListener('pointerlockchange', lockChange);
    this.cleanup.push(() => document.removeEventListener('pointerlockchange', lockChange));
    this.loadLayout();
  }

  private async loadLayout(): Promise<void> {
    try {
      const kb = (navigator as unknown as { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }).keyboard;
      if (kb?.getLayoutMap) this.layout = await kb.getLayoutMap();
    } catch { /* not supported (Firefox/Safari) - fall back to QWERTY labels */ }
  }

  requestLock(): void {
    if (this.locked) return;
    try {
      const p = this.target.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => { /* user gesture required / denied */ });
    } catch { /* ignore */ }
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  releaseAll(): void {
    this.down.clear();
    this.mouseDown = [false, false, false];
  }

  isDown(code: string): boolean { return this.down.has(code); }
  wasPressed(code: string): boolean { return this.pressed.has(code); }
  wasReleased(code: string): boolean { return this.released.has(code); }
  mouse(button: 0 | 1 | 2): boolean { return this.mouseDown[button]; }
  mouseWasPressed(button: 0 | 1 | 2): boolean { return this.mousePressed[button]; }
  mouseWasReleased(button: 0 | 1 | 2): boolean { return this.mouseReleased[button]; }

  /** Call at the END of each frame. */
  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
    this.mousePressed = [false, false, false];
    this.mouseReleased = [false, false, false];
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }

  /** Human label for a key code, layout aware ("KeyW" -> "W" on QWERTY, "Z" on AZERTY). */
  label(code: string): string {
    const special: Record<string, string> = {
      Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'Shift', Escape: 'Esc', Tab: 'Tab', Enter: 'Enter',
      MouseLeft: 'LMB', MouseRight: 'RMB', ControlLeft: 'Ctrl',
    };
    if (special[code]) return special[code];
    const l = this.layout?.get(code);
    if (l) return l.toUpperCase();
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    return code;
  }

  dispose(): void { for (const c of this.cleanup) c(); this.cleanup = []; }
}
