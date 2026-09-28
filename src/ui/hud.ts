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
 * In-world HUD, laid out in zones: economy plate (top-left: money, WP once earned), goals column (top-right:
 * needles, current order, power once a generator exists), crosshair + prompt + denial messages (centre), player
 * strip (bottom centre: stamina, carried hay, wheelbarrow - each only while relevant), onboarding hint, FPS, save.
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
  private readonly wpVisible: ClassSlot;
  private readonly floats: HTMLElement[] = [];
  private floatIdx = 0;
  /** Big "+$X" pop above the crosshair when a load dropped on the SELL HAY belt is sold. */
  private saleNote!: HTMLElement;

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
  /** Stamina bar (bottom centre): shown while in use or not full, fades out when full and idle. */
  private staminaBox!: HTMLElement;
  private staminaFill!: HTMLElement;
  private staminaVisible!: ClassSlot;
  private staminaLow!: ClassSlot;
  private staminaText!: TextSlot;
  private staminaFrac = -1;
  private staminaShowT = 0;
  private lastStamina = -1;

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
    // one plate: small muted label over a heavier value; WP only appears once the player has earned some
    const res = h('div', 'pn-res', el);
    const resRow = (cls: string, ic: string, label: string): [HTMLElement, TextSlot] => {
      const row = h('div', `pn-res-row ${cls}`, res);
      row.innerHTML = `<span class="pn-res-ic">${icon(ic)}</span>`;
      const body = h('div', 'pn-res-body', row);
      h('span', 'pn-res-label', body, label);
      return [row, new TextSlot(h('span', 'pn-res-val', body))];
    };
    [this.moneyChip, this.money.text] = resRow('pn-res-money', 'money', 'Money');
    [this.wpChip, this.wp.text] = resRow('pn-res-wp', 'wp', 'Work Points');
    this.wpVisible = new ClassSlot(this.wpChip, 'is-on');
    const floats = h('div', 'pn-floats', res);
    for (let i = 0; i < FLOATERS; i++) this.floats.push(h('span', 'pn-float', floats));
    this.saleNote = h('div', 'pn-sale-note', el);
    const p = ctx.sim.progress;
    this.money.shown = p.money;
    this.wp.shown = p.wp;
    this.money.text.set(fmtMoney(p.money));
    this.wp.text.set(fmtInt(Math.floor(p.wp)));

    // ----- goals column (top-right): needles, current order, power (only once a generator exists)
    const tr = h('div', 'pn-tr', el);
    const nb = h('div', 'pn-needles', tr);
    const head = h('div', 'pn-needles-head', nb);
    head.innerHTML = `<span class="pn-needles-ic">${icon('needle')}</span><span class="pn-needles-label">Needles</span>`;
    const count = h('span', 'pn-needles-count', head);
    this.needleCount = new TextSlot(h('span', '', count));
    h('small', '', count, `/${NEEDLE_COUNT}`);
    const slots = h('div', 'pn-needle-slots', nb);
    for (let i = 0; i < NEEDLE_COUNT; i++) this.needleSlots.push(h('span', 'pn-needle-slot', slots));

    this.orderBox = h('div', 'pn-order', tr);
    this.orderVisible = new ClassSlot(this.orderBox, 'is-on');
    const ob = h('div', 'pn-order-body', this.orderBox);
    const ohead = h('div', 'pn-order-head', ob);
    ohead.innerHTML = `<span class="pn-order-ic">${icon('order')}</span><span class="pn-order-label">Order</span>`;
    this.orderMore = new TextSlot(h('span', 'pn-order-more', ohead));
    ohead.insertAdjacentHTML('beforeend', keycapHTML('KeyO', (c) => ctx.keyLabel(c)));
    const ot = h('div', 'pn-order-top', ob);
    this.orderTitle = new TextSlot(h('span', 'pn-order-title', ot));
    this.orderNums = new TextSlot(h('span', 'pn-order-nums', ot));
    const otrack = h('div', 'pn-bar pn-order-bar', ob);
    this.orderFill = h('i', 'pn-bar-fill', otrack);

    this.powerBox = h('div', 'pn-power', tr);
    this.powerVisible = new ClassSlot(this.powerBox, 'is-on');
    this.powerOver = new ClassSlot(this.powerBox, 'is-over');
    const ph = h('div', 'pn-power-head', this.powerBox);
    ph.innerHTML = `<span class="pn-power-ic">${icon('power')}</span><span class="pn-power-label">Power</span>`;
    this.powerText = new TextSlot(h('span', 'pn-power-text', ph));
    const track = h('div', 'pn-bar pn-power-bar', this.powerBox);
    this.powerFill = h('i', 'pn-bar-fill', track);
    this.powerWarn = new TextSlot(h('div', 'pn-power-warn', this.powerBox));

    this.orderBox.addEventListener('click', () => { env.sound('uiClick'); ctx.actions.setMode('orders'); });

    // ----- crosshair + carry + prompt (centre)
    const cross = h('div', 'pn-cross', el);
    cross.innerHTML = '<i class="pn-cross-dot"></i><i class="pn-cross-t pn-cross-n"></i><i class="pn-cross-t pn-cross-e"></i><i class="pn-cross-t pn-cross-s"></i><i class="pn-cross-t pn-cross-w"></i>';
    this.crossHay = new ClassSlot(cross, 'is-hay');
    this.crossTarget = new ClassSlot(cross, 'is-target');

    // ----- player strip (bottom centre, above the hotbar): stamina + carried hay + wheelbarrow, each only when relevant
    const player = h('div', 'pn-player', el);
    const meter = (cls: string, ic: string, label: string): { row: HTMLElement; top: HTMLElement; val: TextSlot; fill: HTMLElement } => {
      const row = h('div', `pn-player-row ${cls}`, player);
      row.innerHTML = `<span class="pn-player-ic">${icon(ic)}</span>`;
      const body = h('div', 'pn-player-body', row);
      const top = h('div', 'pn-player-top', body);
      h('span', 'pn-player-label', top, label);
      const val = new TextSlot(h('span', 'pn-player-val', top));
      const fill = h('i', 'pn-bar-fill', h('div', 'pn-bar', body));
      return { row, top, val, fill };
    };
    const st = meter('pn-stamina', 'boots', 'Stamina');
    this.staminaBox = st.row;
    this.staminaFill = st.fill;
    this.staminaText = st.val;
    this.staminaVisible = new ClassSlot(this.staminaBox, 'is-on');
    this.staminaLow = new ClassSlot(this.staminaBox, 'is-low');

    const ca = meter('pn-carry', 'hay', 'Hay');
    this.carryBox = ca.row;
    this.carryText = ca.val;
    this.carryFill = ca.fill;
    this.carryTag = new TextSlot(h('span', 'pn-carry-tag', ca.top));
    this.carryVisible = new ClassSlot(this.carryBox, 'is-on');
    this.carryFull = new ClassSlot(this.carryBox, 'is-full');
    const ba = meter('pn-barrow', 'wheelbarrow', 'Barrow');
    this.barrowRow = ba.row;
    this.barrowText = ba.val;
    this.barrowFill = ba.fill;
    this.barrowVisible = new ClassSlot(this.barrowRow, 'is-on');

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
    env.listen('sale', (e) => {
      if (e.viaBelt || !(e.value > 0)) return;
      replayClass(this.moneyChip, 'is-gain');
      this.floater(`+${fmtMoney(e.value)}`, 'money');
      // manual sales only happen when a load from the SELL HAY belt reaches the chute: make that moment readable
      this.saleNote.textContent = `+${fmtMoney(e.value)}`;
      replayClass(this.saleNote, 'is-on');
    });
    env.listen('wp:changed', (e) => { if (e.delta > 0) this.floater(`+${fmtInt(e.delta)} WP`, 'wp'); });
    env.listen('money:changed', (e) => { if (e.delta < 0) replayClass(this.moneyChip, 'is-spend'); });
    env.listen('needle:found', () => this.refreshNeedles());
    env.listen('player:denied', (e) => this.message(e.reason, 'bad'));
    env.listen('player:tired', () => { this.staminaShowT = 1.5; replayClass(this.staminaBox, 'is-bump'); this.message('Too tired - catch your breath', 'warn'); });
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

    this.updateStamina(dt, mode);

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

  /** Stamina bar, every frame (the bar tracks sprinting smoothly). */
  private updateStamina(dt: number, mode: GameMode): void {
    const st = this.env.ctx.sim.player.stamina;
    if (st.value < this.lastStamina - 1e-6) this.staminaShowT = 1.2; // just spent: keep the bar up a moment
    this.lastStamina = st.value;
    if (this.staminaShowT > 0) this.staminaShowT -= dt;
    this.staminaVisible.set(mode === 'play' && (st.value < st.max - 0.5 || this.staminaShowT > 0));
    this.staminaLow.set(st.exhausted || st.fraction < 0.2);
    const sf = Math.round(st.fraction * 200) / 200;
    if (sf !== this.staminaFrac) {
      this.staminaFrac = sf;
      this.staminaFill.style.transform = `scaleX(${sf})`;
      this.staminaText.set(`${Math.round(st.fraction * 100)}%`);
    }
  }

  private slowUpdate(mode: GameMode): void {
    const ctx = this.env.ctx;
    const sim = ctx.sim;
    const prog = sim.progress;

    if (prog.needlesFound.length !== this.needlesShown) this.refreshNeedles();
    // progressive disclosure: Work Points only once the player has earned or spent some
    this.wpVisible.set(prog.wp > 0 || prog.stats.wpEarned > 0 || prog.nodes.size > 0);

    // ----- power
    const supply = sim.power.totalSupply;
    const demand = sim.power.totalDemand;
    const hasPower = supply > 0.05 || demand > 0.05;
    this.powerVisible.set(hasPower);
    if (hasPower) {
      const over = demand > supply + 0.05;
      this.powerOver.set(over);
      this.powerText.set(`${fmtInt(demand)} / ${fmtInt(supply)}`);
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

    const player = sim.player;
    // ----- carry
    const cap = Math.max(1, carryCapacity(sim));
    const w = player.carry.weight();
    const full = w >= cap - 1e-3;
    const barrow = player.wheelbarrow;
    const held = !!barrow?.held;
    this.carryVisible.set(mode === 'play' && (w > 0.01 || held || this.fullFlash > 0));
    this.carryFull.set(full);
    this.carryText.set(`${fmtInt(Math.floor(w + 1e-6))}/${fmtInt(cap)}`);
    this.carryTag.set(full ? 'FULL' : '');
    const cf = Math.round(Math.min(1, w / cap) * 100) / 100;
    if (cf !== this.carryFrac) { this.carryFrac = cf; this.carryFill.style.transform = `scaleX(${cf})`; }
    this.barrowVisible.set(held);
    if (barrow && held) {
      const bcap = Math.max(1, sim.stat('wheelbarrow.capacity'));
      const bw = barrow.inv.weight();
      this.barrowText.set(`${fmtInt(Math.floor(bw + 1e-6))}/${fmtInt(bcap)}`);
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
    this.needleCount.set(`${found}`);
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

