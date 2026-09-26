import type { GameMode } from './context';
import { ClassSlot, h, TextSlot } from './dom';
import { fmtOne, relativeBearing, signalBars } from './format';
import { icon } from './icons';
import type { PartEnv, UIPart } from './part';

const BARS = 8;

/** Metal detector readout: signal bars, TOO DEEP warning, arrow + distance when upgraded. */
export class DetectorHud implements UIPart {
  private readonly el: HTMLElement;
  private readonly visible: ClassSlot;
  private readonly bars: ClassSlot[] = [];
  private readonly state: TextSlot;
  private readonly sub: TextSlot;
  private readonly arrowBox: HTMLElement;
  private readonly arrowVisible: ClassSlot;
  private readonly arrow: HTMLElement;
  private readonly dist: TextSlot;
  private mode: 'none' | 'signal' | 'deep' | null = null;
  private lit = -1;
  private angle = NaN;

  constructor(private readonly env: PartEnv, parent: HTMLElement) {
    const el = (this.el = h('div', 'pn-det', parent));
    this.visible = new ClassSlot(el, 'is-on');
    const head = h('div', 'pn-det-head', el);
    head.innerHTML = `<span class="pn-det-ic">${icon('detector')}</span><span class="pn-det-name">Detector</span>`;
    this.state = new TextSlot(h('span', 'pn-det-state', head));
    const body = h('div', 'pn-det-body', el);
    const bars = h('div', 'pn-det-bars', body);
    for (let i = 0; i < BARS; i++) {
      const b = h('i', 'pn-det-bar', bars);
      b.style.setProperty('--i', String(i));
      this.bars.push(new ClassSlot(b, 'is-lit'));
    }
    this.arrowBox = h('div', 'pn-det-dir', body);
    this.arrowVisible = new ClassSlot(this.arrowBox, 'is-on');
    this.arrow = h('span', 'pn-det-arrow', this.arrowBox);
    this.arrow.innerHTML = icon('arrow');
    this.dist = new TextSlot(h('span', 'pn-det-dist', this.arrowBox));
    this.sub = new TextSlot(h('div', 'pn-det-sub', el));
  }

  update(_dt: number, mode: GameMode): void {
    const ctx = this.env.ctx;
    const r = mode === 'play' ? ctx.getDetector() : null;
    this.visible.set(!!r);
    if (!r) return;
    const sim = ctx.sim;
    const signal = r.strength > 0;
    const next = signal ? 'signal' : r.tooDeep ? 'deep' : 'none';
    if (next !== this.mode) {
      this.mode = next;
      this.el.className = `pn-det is-on is-${next}`;
      if (next === 'deep') { this.state.set('TOO DEEP'); this.sub.set('A needle is buried deeper than your detector can sense'); }
      else if (next === 'none') { this.state.set('No signal'); this.sub.set('Sweep over the stack and listen for beeps'); }
      else this.sub.set('');
    }
    const lit = signalBars(r.strength, BARS);
    if (lit !== this.lit) {
      this.lit = lit;
      for (let i = 0; i < BARS; i++) this.bars[i].set(i < lit);
    }
    if (signal) this.state.set(`${Math.round(r.strength * 100)}%`);

    const directional = sim.stat('tool.detector.directional') >= 1;
    const precise = sim.stat('tool.detector.precision') >= 1;
    const showDir = signal && (directional || precise);
    this.arrowVisible.set(showDir);
    if (showDir) {
      this.arrow.style.visibility = directional ? '' : 'hidden';
      if (directional) {
        const a = Math.round((relativeBearing(r.dirX, r.dirZ, sim.player.yaw) * 180) / Math.PI);
        if (a !== this.angle) { this.angle = a; this.arrow.style.transform = `rotate(${a}deg)`; }
      }
      this.dist.set(`${fmtOne(r.distance)} m`);
    }
  }

  destroy(): void { this.el.remove(); }
}
