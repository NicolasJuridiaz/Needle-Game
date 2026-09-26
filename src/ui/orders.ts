import { MAX_ACTIVE_ORDERS, ORDER_BY_ID, ORDERS } from '../config/orders';
import { ClassSlot, h, replayClass, TextSlot } from './dom';
import { fmtInt, fmtPrice, orderProgress } from './format';
import { icon } from './icons';
import { Panel, type PartEnv } from './part';

interface OrderCard {
  el: HTMLElement;
  id: string;
  client: TextSlot;
  title: TextSlot;
  nums: TextSlot;
  unit: TextSlot;
  fill: HTMLElement;
  frac: number;
  money: TextSlot;
  wp: TextSlot;
  hint: TextSlot;
}

/** Order board: up to three active contracts with progress, rewards and a hint each. */
export class Orders extends Panel {
  private readonly cards: OrderCard[] = [];
  private readonly empty: ClassSlot;
  private readonly doneText: TextSlot;
  private slow = 0;

  constructor(env: PartEnv, parent: HTMLElement) {
    super(env, parent, 'orders', 'pn-orders-screen');
    const panel = h('div', 'pn-panel pn-orders', this.el);
    const head = h('div', 'pn-panel-head', panel);
    head.innerHTML = `<span class="pn-panel-title-ic">${icon('order')}</span><span class="pn-panel-title">Order Board</span>`;
    this.doneText = new TextSlot(h('span', 'pn-orders-done', head));
    h('div', 'pn-panel-spacer', head);
    this.closeButton(head, 'KeyO');
    h('p', 'pn-orders-intro', panel, 'Orders pay money and Work Points. Complete them to unlock new ones.');
    const list = h('div', 'pn-orders-list', panel);
    for (let i = 0; i < MAX_ACTIVE_ORDERS; i++) {
      const el = h('div', 'pn-ocard', list);
      const top = h('div', 'pn-ocard-top', el);
      top.innerHTML = `<span class="pn-ocard-pin"></span>`;
      const client = new TextSlot(h('span', 'pn-ocard-client', top));
      const title = new TextSlot(h('div', 'pn-ocard-title', el));
      const prog = h('div', 'pn-ocard-prog', el);
      const nums = new TextSlot(h('span', 'pn-ocard-nums', prog));
      const unit = new TextSlot(h('span', 'pn-ocard-unit', prog));
      const track = h('div', 'pn-bar pn-ocard-bar', el);
      const fill = h('i', 'pn-bar-fill', track);
      const rew = h('div', 'pn-ocard-reward', el);
      h('span', 'pn-ocard-reward-label', rew, 'Reward');
      const m = h('span', 'pn-ocard-money', rew);
      m.innerHTML = icon('money');
      const money = new TextSlot(h('span', '', m));
      const w = h('span', 'pn-ocard-wp', rew);
      w.innerHTML = icon('wp');
      const wp = new TextSlot(h('span', '', w));
      const hint = h('div', 'pn-ocard-hint', el);
      hint.innerHTML = icon('info');
      this.cards.push({ el, id: '', client, title, nums, unit, fill, frac: -1, money, wp, hint: new TextSlot(h('span', '', hint)) });
    }
    const empty = h('div', 'pn-orders-empty', list);
    empty.innerHTML = `${icon('trophy')}<span>Every order is complete. The county thanks you!</span>`;
    this.empty = new ClassSlot(empty, 'is-on');
  }

  protected override onOpen(): void { this.refresh(); }

  protected tick(dt: number): void {
    this.slow += dt;
    if (this.slow < 0.2) return;
    this.slow = 0;
    this.refresh();
  }

  private refresh(): void {
    const p = this.env.ctx.sim.progress;
    const active = p.activeOrders();
    let done = 0;
    for (const o of p.orders) if (o.completed) done++;
    this.doneText.set(`Completed ${done} / ${ORDERS.length}`);
    this.empty.set(active.length === 0);
    for (let i = 0; i < this.cards.length; i++) {
      const c = this.cards[i];
      const o = i < active.length ? active[i] : null;
      const def = o ? ORDER_BY_ID[o.id] : undefined;
      c.el.classList.toggle('is-hidden', !def);
      if (!o || !def) { c.id = ''; continue; }
      if (c.id !== o.id) {
        c.id = o.id;
        c.client.set(def.client);
        c.title.set(def.title);
        c.hint.set(def.hint);
        replayClass(c.el, 'is-new');
      }
      const t = orderProgress(def, o.progress);
      c.nums.set(`${t.cur} / ${t.target}`);
      c.unit.set(t.unit);
      const q = Math.round(t.frac * 200) / 200;
      if (q !== c.frac) { c.frac = q; c.fill.style.transform = `scaleX(${q})`; }
      const r = p.orderReward(def);
      c.money.set(fmtPrice(r.money));
      c.wp.set(`${fmtInt(r.wp)} WP`);
    }
  }
}
