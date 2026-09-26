import { NEEDLE_BUFFS, NEEDLE_COUNT } from '../config/needles';
import { ORDER_BY_ID } from '../config/orders';
import { carryCapacity } from '../sim/playerActions';
import type { GameMode } from './context';
import { ClassSlot, h, replayClass, TextSlot } from './dom';
import { fmtInt, fmtMoney, fmtPct, orderProgress } from './format';
import { icon, setIcon } from './icons';
import { HUD_MODES, keycapHTML, type PartEnv, type UIPart } from './part';

const SLOW_DT = 0.1;
const FLOATERS = 5;

/**
 * In-world HUD: money/WP (count-up + floaters), needles, power, current order, crosshair,
 * carry meter, interaction prompt, denial messages, onboarding hint, FPS and save indicator.
 * Hotbar, machine tooltip, detector and build HUD are separate parts sharing the same layer.
 */
export class Hud implements UIPart {
  private readonly el: HTMLElement;
  private readonly visible: ClassSlot;
  private slow = 0;

  // resources
  private money = { shown: 0, text: null as unknown as TextSlot };
  private wp = { shown: 0, text: null as unknown as TextSlot };
  private readonly moneyChip: HTMLElement;
  private readonly wpChip: HTMLElement;
  private readonly floats: HTMLElement[] = [];
  private floatIdx = 0;

  // needles
  private readonly needleCount: TextSlot;
  private readonly needleSlots: HTMLElement[] = [];
  private needlesShown = -1;

  // power
  private readonly powerBox: HTMLElement;
  private readonly powerVisible: ClassSlot;
  private readonly powerOver: ClassSlot;
  private readonly powerText: TextSlot;
  private readonly powerFill: HTMLElement;
  private readonly powerWarn: TextSlot;
  private powerFrac = -1;

  // order
  private readonly orderBox: HTMLElement;
  private readonly orderVisible: ClassSlot;
  private readonly orderTitle: TextSlot;
  private readonly orderNums: TextSlot;
  private readonly orderMore: TextSlot;
  private readonly orderFill: HTMLElement;
  private orderFrac = -1;

  // crosshair / carry / prompt
  private readonly crossHay: ClassSlot;
  private readonly crossTarget: ClassSlot;
  private readonly carryBox: HTMLElement;
  private readonly carryVisible: ClassSlot;
  private readonly carryFull: ClassSlot;
  private readonly carryText: TextSlot;
  private readonly carryFill: HTMLElement;
  private readonly carryTag: TextSlot;
  private readonly barrowRow: HTMLElement;
  private readonly barrowVisible: ClassSlot;
  private readonly barrowText: TextSlot;
  private readonly barrowFill: HTMLElement;
  private carryFrac = -1;
  private barrowFrac = -1;
  private fullFlash = 0;

  private readonly prompt: HTMLElement;
  private readonly promptVisible: ClassSlot;
  private readonly promptDisabled: ClassSlot;
  private readonly promptKey: HTMLElement;
  private readonly promptText: TextSlot;
  private readonly promptReason: TextSlot;
  private promptKeyValue = '';

  private readonly msg: HTMLElement;
  private readonly msgText: TextSlot;
  private msgTimer = 0;

  // hint / fps / saved
  private readonly hint: HTMLElement;
  private readonly hintVisible: ClassSlot;
  private readonly hintText: TextSlot;
  private readonly hintKey: HTMLElement;
  private hintKeyValue = '';
  private readonly fps: HTMLElement;
  private readonly fpsVisible: ClassSlot;
  private readonly fpsText: TextSlot;
  private readonly saved: HTMLElement;
  private savedTimer = 0;

  constructor(private readonly env: PartEnv, parent: HTMLElement) {
    const ctx = env.ctx;
    const el = (this.el = h('div', 'pn-hud-main', parent));
    this.visible = new ClassSlot(el, 'is-hidden');

    // ----- resources (top-left)
    const res = h('div', 'pn-res', el);
    this.moneyChip = h('div', 'pn-res-row pn-res-money', res);
    this.moneyChip.innerHTML = `<span class="pn-res-ic">${icon('money')}</span>`;
    this.money.text = new TextSlot(h('span', 'pn-res-val', this.moneyChip));
    this.wpChip = h('div', 'pn-res-row pn-res-wp', res);
    this.wpChip.innerHTML = `<span class="pn-res-ic">${icon('wp')}</span>`;
    this.wp.text = new TextSlot(h('span', 'pn-res-val', this.wpChip));
    h('span', 'pn-res-unit', this.wpChip, 'WP');
    const floats = h('div', 'pn-floats', res);
    for (let i = 0; i < FLOATERS; i++) this.floats.push(h('span', 'pn-float', floats));
    const p = ctx.sim.progress;
    this.money.shown = p.money;
    this.wp.shown = p.wp;
    this.money.text.set(fmtMoney(p.money));
    this.wp.text.set(fmtInt(Math.floor(p.wp)));

    // ----- needles + power (top-right)
    const tr = h('div', 'pn-tr', el);
    const nb = h('div', 'pn-needles', tr);
    const head = h('div', 'pn-needles-head', nb);
    head.innerHTML = `<span class="pn-needles-ic">${icon('needle')}</span><span class="pn-needles-label">Needles</span>`;
    this.needleCount = new TextSlot(h('span', 'pn-needles-count', head));
    const slots = h('div', 'pn-needle-slots', nb);
    for (let i = 0; i < NEEDLE_COUNT; i++) this.needleSlots.push(h('span', 'pn-needle-slot', slots));

    this.powerBox = h('div', 'pn-power', tr);
    this.powerVisible = new ClassSlot(this.powerBox, 'is-on');
    this.powerOver = new ClassSlot(this.powerBox, 'is-over');
    const ph = h('div', 'pn-power-head', this.powerBox);
    ph.innerHTML = `<span class="pn-power-ic">${icon('power')}</span>`;
    this.powerText = new TextSlot(h('span', 'pn-power-text', ph));
    const track = h('div', 'pn-bar pn-power-bar', this.powerBox);
    this.powerFill = h('i', 'pn-bar-fill', track);
    this.powerWarn = new TextSlot(h('div', 'pn-power-warn', this.powerBox));

    // ----- current order (top-centre)
    this.orderBox = h('div', 'pn-order', el);
    this.orderVisible = new ClassSlot(this.orderBox, 'is-on');
    this.orderBox.innerHTML = `<span class="pn-order-ic">${icon('order')}</span>`;
    const ob = h('div', 'pn-order-body', this.orderBox);
    const ot = h('div', 'pn-order-top', ob);
    this.orderTitle = new TextSlot(h('span', 'pn-order-title', ot));
    this.orderNums = new TextSlot(h('span', 'pn-order-nums', ot));
    const otrack = h('div', 'pn-bar pn-order-bar', ob);
    this.orderFill = h('i', 'pn-bar-fill', otrack);
    this.orderMore = new TextSlot(h('span', 'pn-order-more', this.orderBox));
    this.orderBox.insertAdjacentHTML('beforeend', keycapHTML('KeyO', (c) => ctx.keyLabel(c)));
    this.orderBox.addEventListener('click', () => { env.sound('uiClick'); ctx.actions.setMode('orders'); });

    // ----- crosshair + carry + prompt (centre)
    const cross = h('div', 'pn-cross', el);
    cross.innerHTML = '<i class="pn-cross-dot"></i><i class="pn-cross-t pn-cross-n"></i><i class="pn-cross-t pn-cross-e"></i><i class="pn-cross-t pn-cross-s"></i><i class="pn-cross-t pn-cross-w"></i>';
    this.crossHay = new ClassSlot(cross, 'is-hay');
    this.crossTarget = new ClassSlot(cross, 'is-target');

    this.carryBox = h('div', 'pn-carry', el);
    this.carryVisible = new ClassSlot(this.carryBox, 'is-on');
    this.carryFull = new ClassSlot(this.carryBox, 'is-full');
    const cr = h('div', 'pn-carry-row', this.carryBox);
    cr.innerHTML = `<span class="pn-carry-ic">${icon('hay')}</span>`;
    const cb = h('div', 'pn-carry-body', cr);
    const ctop = h('div', 'pn-carry-top', cb);
    this.carryText = new TextSlot(h('span', 'pn-carry-text', ctop));
    this.carryTag = new TextSlot(h('span', 'pn-carry-tag', ctop));
    const ctrack = h('div', 'pn-bar pn-carry-bar', cb);
    this.carryFill = h('i', 'pn-bar-fill', ctrack);
    this.barrowRow = h('div', 'pn-carry-row pn-carry-barrow', this.carryBox);
    this.barrowVisible = new ClassSlot(this.barrowRow, 'is-on');
    this.barrowRow.innerHTML = `<span class="pn-carry-ic">${icon('wheelbarrow')}</span>`;
    const bb = h('div', 'pn-carry-body', this.barrowRow);
    this.barrowText = new TextSlot(h('span', 'pn-carry-text', bb));
    const btrack = h('div', 'pn-bar pn-carry-bar', bb);
    this.barrowFill = h('i', 'pn-bar-fill', btrack);

    this.prompt = h('div', 'pn-prompt', el);
    this.promptVisible = new ClassSlot(this.prompt, 'is-on');
    this.promptDisabled = new ClassSlot(this.prompt, 'is-disabled');
    const pr = h('div', 'pn-prompt-row', this.prompt);
    this.promptKey = h('span', 'pn-prompt-key', pr);
    this.promptText = new TextSlot(h('span', 'pn-prompt-text', pr));
    this.promptReason = new TextSlot(h('div', 'pn-prompt-reason', this.prompt));

    this.msg = h('div', 'pn-msg', el);
    this.msgText = new TextSlot(this.msg);

    // ----- hint (bottom, above the hotbar)
    this.hint = h('div', 'pn-hint', el);
    this.hintVisible = new ClassSlot(this.hint, 'is-on');
    this.hint.innerHTML = `<span class="pn-hint-ic">${icon('info')}</span>`;
    this.hintKey = h('span', 'pn-hint-key', this.hint);
    this.hintText = new TextSlot(h('span', 'pn-hint-text', this.hint));

    // ----- fps + saved (bottom-left)
    this.fps = h('div', 'pn-fps', el);
    this.fpsVisible = new ClassSlot(this.fps, 'is-on');
    this.fpsText = new TextSlot(this.fps);
    this.saved = h('div', 'pn-saved', el);
    this.saved.innerHTML = `${icon('save')}<span>Saved</span>`;

    this.refreshNeedles();

    // ----- events
    env.listen('sale', (e) => { if (!e.viaBelt && e.value > 0) this.floater(`+${fmtMoney(e.value)}`, 'money'); });
    env.listen('wp:changed', (e) => { if (e.delta > 0) this.floater(`+${fmtInt(e.delta)} WP`, 'wp'); });
    env.listen('money:changed', (e) => { if (e.delta < 0) replayClass(this.moneyChip, 'is-spend'); });
    env.listen('needle:found', () => this.refreshNeedles());
    env.listen('player:denied', (e) => this.message(e.reason, 'bad'));
    env.listen('player:full', () => { this.fullFlash = 1.2; replayClass(this.carryBox, 'is-bump'); this.message('Carry full - sell or deposit it (E)', 'warn'); });
    env.listen('game:saved', () => { this.savedTimer = 1.8; replayClass(this.saved, 'is-on'); });
  }

  update(dt: number, mode: GameMode): void {
    const show = HUD_MODES.has(mode);
    this.visible.set(!show);
    if (!show) return;
    const ctx = this.env.ctx;
    const sim = ctx.sim;
    const prog = sim.progress;

    // count-up (per frame, DOM only on integer change)
    const k = 1 - Math.exp(-dt * 9);
    this.money.shown = approach(this.money.shown, prog.money, k);
    this.money.text.set(fmtMoney(this.money.shown));
    this.wp.shown = approach(this.wp.shown, prog.wp, k);
    this.wp.text.set(fmtInt(Math.floor(this.wp.shown + 1e-6)));

    // timers
    if (this.msgTimer > 0) { this.msgTimer -= dt; if (this.msgTimer <= 0) this.msg.classList.remove('is-on'); }
    if (this.savedTimer > 0) { this.savedTimer -= dt; if (this.savedTimer <= 0) this.saved.classList.remove('is-on'); }
    if (this.fullFlash > 0) this.fullFlash -= dt;

    // aim (per frame: the prompt must feel instant)
    const aim = ctx.getAim();
    const build = mode === 'build';
    this.crossHay.set(!build && aim.hay);
    this.crossTarget.set(!!aim.info || !!aim.prompt);
    const pr = build ? null : aim.prompt;
    this.promptVisible.set(!!pr);
    if (pr) {
      this.promptDisabled.set(!pr.enabled);
      if (pr.key !== this.promptKeyValue) {
        this.promptKeyValue = pr.key;
        this.promptKey.innerHTML = keycapHTML(pr.key, (c) => ctx.keyLabel(c));
      }
      this.promptText.set(pr.text);
      this.promptReason.set(!pr.enabled && pr.reason ? pr.reason : '');
    }

    this.slow += dt;
    if (this.slow < SLOW_DT) return;
    this.slow = 0;
    this.slowUpdate(mode);
  }

  private slowUpdate(mode: GameMode): void {
    const ctx = this.env.ctx;
    const sim = ctx.sim;
    const prog = sim.progress;

    if (prog.needlesFound.length !== this.needlesShown) this.refreshNeedles();

    // ----- power
    const supply = sim.power.totalSupply;
    const demand = sim.power.totalDemand;
    const hasPower = supply > 0.05 || demand > 0.05;
    this.powerVisible.set(hasPower);
    if (hasPower) {
      const over = demand > supply + 0.05;
      this.powerOver.set(over);
      this.powerText.set(`${fmtInt(demand)} / ${fmtInt(supply)} P`);
      const f = supply > 0 ? Math.min(1, demand / supply) : 1;
      const q = Math.round(f * 200) / 200;
      if (q !== this.powerFrac) { this.powerFrac = q; this.powerFill.style.transform = `scaleX(${q})`; }
      this.powerWarn.set(over ? (supply > 0 ? `Factory at ${fmtPct(supply / demand)} speed` : 'No generator running') : '');
    }

    // ----- current order
    const active = prog.activeOrders();
    const o = active.length ? active[0] : null;
    const def = o ? ORDER_BY_ID[o.id] : undefined;
    this.orderVisible.set(!!def && mode === 'play');
    if (o && def) {
      const t = orderProgress(def, o.progress);
      this.orderTitle.set(def.title);
      this.orderNums.set(`${t.cur} / ${t.target}`);
      const q = Math.round(t.frac * 200) / 200;
      if (q !== this.orderFrac) { this.orderFrac = q; this.orderFill.style.transform = `scaleX(${q})`; }
      this.orderMore.set(active.length > 1 ? `+${active.length - 1}` : '');
    }

    // ----- carry
    const player = sim.player;
    const cap = Math.max(1, carryCapacity(sim));
    const w = player.carry.weight();
    const full = w >= cap - 1e-3;
    const barrow = player.wheelbarrow;
    const held = !!barrow?.held;
    this.carryVisible.set(mode === 'play' && (w > 0.01 || held || this.fullFlash > 0));
    this.carryFull.set(full);
    this.carryText.set(`${fmtInt(Math.floor(w + 1e-6))} / ${fmtInt(cap)}`);
    this.carryTag.set(full ? 'FULL' : '');
    const cf = Math.round(Math.min(1, w / cap) * 100) / 100;
    if (cf !== this.carryFrac) { this.carryFrac = cf; this.carryFill.style.transform = `scaleX(${cf})`; }
    this.barrowVisible.set(held);
    if (barrow && held) {
      const bcap = Math.max(1, sim.stat('wheelbarrow.capacity'));
      const bw = barrow.inv.weight();
      this.barrowText.set(`${fmtInt(Math.floor(bw + 1e-6))} / ${fmtInt(bcap)}`);
      const bf = Math.round(Math.min(1, bw / bcap) * 100) / 100;
      if (bf !== this.barrowFrac) { this.barrowFrac = bf; this.barrowFill.style.transform = `scaleX(${bf})`; }
    }

    // ----- hint
    const hint = ctx.getHint();
    this.hintVisible.set(!!hint);
    if (hint) {
      this.hintText.set(hint.text);
      const key = hint.key ?? '';
      if (key !== this.hintKeyValue) {
        this.hintKeyValue = key;
        this.hintKey.innerHTML = key ? keycapHTML(key, (c) => ctx.keyLabel(c)) : '';
      }
    }

    // ----- fps
    const showFps = ctx.settings.showFps;
    this.fpsVisible.set(showFps);
    if (showFps) this.fpsText.set(`${Math.round(ctx.getFps())} FPS`);
  }

  private refreshNeedles(): void {
    const found = this.env.ctx.sim.progress.needlesFound.length;
    this.needlesShown = found;
    this.needleCount.set(`${found}/${NEEDLE_COUNT}`);
    for (let i = 0; i < this.needleSlots.length; i++) {
      const s = this.needleSlots[i];
      const on = i < found;
      s.classList.toggle('is-found', on);
      const buff = NEEDLE_BUFFS[i];
      if (on && buff) {
        setIcon(s, buff.icon);
        s.title = `${buff.name}: ${buff.desc}`;
      } else {
        setIcon(s, 'needle');
        s.title = 'Needle not found yet';
      }
    }
  }

  private floater(text: string, kind: 'money' | 'wp'): void {
    const f = this.floats[this.floatIdx];
    this.floatIdx = (this.floatIdx + 1) % this.floats.length;
    f.textContent = text;
    f.className = `pn-float pn-float--${kind}`;
    replayClass(f, 'is-on');
  }

  private message(text: string, tone: 'bad' | 'warn'): void {
    this.msgText.set(text);
    this.msg.className = `pn-msg pn-msg--${tone}`;
    replayClass(this.msg, 'is-on');
    this.msgTimer = 1.8;
  }

  destroy(): void { this.el.remove(); }
}

function approach(shown: number, target: number, k: number): number {
  const d = target - shown;
  if (Math.abs(d) < 0.5) return target;
  return shown + d * Math.max(k, Math.min(1, 0.6 / Math.abs(d)));
}

