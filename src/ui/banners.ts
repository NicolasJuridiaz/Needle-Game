import { NEEDLE_BUFFS, NEEDLE_COUNT } from '../config/needles';
import { ORDER_BY_ID } from '../config/orders';
import type { GameMode } from './context';
import { h, replayClass, TextSlot } from './dom';
import { fmtInt, fmtPrice } from './format';
import { icon, setIcon } from './icons';
import { LIVE_MODES, type PartEnv, type UIPart } from './part';

type BannerKind = 'milestone' | 'order';

interface BannerItem { kind: BannerKind; label: string; title: string; sub: string; reward: string; icon: string }
interface NeedleItem { index: number; by: 'manual' | 'scanner' | 'detector'; buffName: string; buffDesc: string; buffIcon: string; wp: number; money: number }

const BANNER_TIME = 3.0;
const BANNER_OUT = 0.35;
const NEEDLE_TIME = 3.6;
const NEEDLE_OUT = 0.45;
const MAX_QUEUE = 12;

const FOUND_BY: Record<NeedleItem['by'], string> = {
  manual: 'Found by hand',
  detector: 'Tracked down with the Metal Detector',
  scanner: 'Caught by a Needle Scanner',
};

function rewardText(money: number, wp: number): string {
  const parts: string[] = [];
  if (money > 0) parts.push(`+${fmtPrice(money)}`);
  if (wp > 0) parts.push(`+${fmtInt(wp)} WP`);
  return parts.join('   ');
}

/**
 * Top-centre milestone / order-complete banners (queued) and the big centred NEEDLE FOUND presentation
 * (queued, ~3.6 s each). Queues only advance while the game is live, so nothing is missed behind menus.
 */
export class Banners implements UIPart {
  private readonly banner: HTMLElement;
  private readonly bIc: HTMLElement;
  private readonly bLabel: TextSlot;
  private readonly bTitle: TextSlot;
  private readonly bSub: TextSlot;
  private readonly bReward: TextSlot;
  private readonly bQueue: BannerItem[] = [];
  private bTime = -1;

  private readonly needle: HTMLElement;
  private readonly nCount: TextSlot;
  private readonly nBuffIc: HTMLElement;
  private readonly nBuff: TextSlot;
  private readonly nDesc: TextSlot;
  private readonly nReward: TextSlot;
  private readonly nBy: TextSlot;
  private readonly nFinal: HTMLElement;
  private readonly nQueue: NeedleItem[] = [];
  private nTime = -1;

  constructor(private readonly env: PartEnv, parent: HTMLElement) {
    // ----- banner
    const b = (this.banner = h('div', 'pn-banner', parent));
    this.bIc = h('span', 'pn-banner-ic', b);
    const bt = h('div', 'pn-banner-body', b);
    this.bLabel = new TextSlot(h('div', 'pn-banner-label', bt));
    this.bTitle = new TextSlot(h('div', 'pn-banner-title', bt));
    this.bSub = new TextSlot(h('div', 'pn-banner-sub', bt));
    this.bReward = new TextSlot(h('div', 'pn-banner-reward', b));

    // ----- needle presentation
    const n = (this.needle = h('div', 'pn-needlefx', parent));
    h('div', 'pn-needlefx-glow', n);
    const card = h('div', 'pn-needlefx-card', n);
    const art = h('div', 'pn-needlefx-art', card);
    h('div', 'pn-needlefx-rays', art);
    const sparks = h('div', 'pn-needlefx-sparks', art);
    for (let i = 0; i < 10; i++) {
      const s = h('i', '', sparks);
      s.style.setProperty('--a', `${i * 36 + (i % 2) * 14}deg`);
      s.style.setProperty('--d', `${(i % 3) * 0.12}s`);
    }
    h('div', 'pn-needlefx-needle', art).innerHTML = icon('needle');
    h('div', 'pn-needlefx-label', card, 'Needle found');
    this.nCount = new TextSlot(h('div', 'pn-needlefx-count', card));
    const buff = h('div', 'pn-needlefx-buff', card);
    this.nBuffIc = h('span', 'pn-needlefx-buff-ic', buff);
    this.nBuff = new TextSlot(h('span', 'pn-needlefx-buff-name', buff));
    this.nDesc = new TextSlot(h('div', 'pn-needlefx-desc', card));
    this.nReward = new TextSlot(h('div', 'pn-needlefx-reward', card));
    this.nBy = new TextSlot(h('div', 'pn-needlefx-by', card));
    this.nFinal = h('div', 'pn-needlefx-final', card, 'All needles found!');

    // ----- events
    env.listen('needle:found', (e) => {
      const buffDef = NEEDLE_BUFFS[e.index];
      this.enqueue(this.nQueue, { index: e.index, by: e.by, buffName: e.buffName, buffDesc: e.buffDesc, buffIcon: buffDef?.icon ?? 'star', wp: e.wp, money: e.money });
    });
    env.listen('order:completed', (e) => {
      const def = ORDER_BY_ID[e.id];
      this.enqueue(this.bQueue, { kind: 'order', label: 'Order complete', title: def?.title ?? e.id, sub: def?.client ?? '', reward: rewardText(e.money, e.wp), icon: 'order' });
    });
    env.listen('milestone', (e) => {
      this.enqueue(this.bQueue, { kind: 'milestone', label: 'Milestone', title: e.name, sub: '', reward: rewardText(e.money, e.wp), icon: 'trophy' });
    });
  }

  private enqueue<T>(q: T[], item: T): void {
    if (q.length >= MAX_QUEUE) q.shift();
    q.push(item);
  }

  update(dt: number, mode: GameMode): void {
    const live = LIVE_MODES.has(mode);
    this.banner.classList.toggle('is-held', !live);
    this.needle.classList.toggle('is-held', !live);
    if (!live) return;

    // needle presentation first: banners wait while it is on screen
    if (this.nTime >= 0) {
      this.nTime += dt;
      if (this.nTime >= NEEDLE_TIME && !this.needle.classList.contains('is-out')) this.needle.classList.add('is-out');
      if (this.nTime >= NEEDLE_TIME + NEEDLE_OUT) { this.nTime = -1; this.needle.classList.remove('is-on', 'is-out'); }
      return;
    }
    if (this.nQueue.length) { this.showNeedle(this.nQueue.shift() as NeedleItem); return; }

    if (this.bTime >= 0) {
      this.bTime += dt;
      if (this.bTime >= BANNER_TIME && !this.banner.classList.contains('is-out')) this.banner.classList.add('is-out');
      if (this.bTime >= BANNER_TIME + BANNER_OUT) { this.bTime = -1; this.banner.classList.remove('is-on', 'is-out'); }
      return;
    }
    if (this.bQueue.length) this.showBanner(this.bQueue.shift() as BannerItem);
  }

  private showBanner(it: BannerItem): void {
    this.banner.className = `pn-banner pn-banner--${it.kind}`;
    setIcon(this.bIc, it.icon);
    this.bLabel.set(it.label);
    this.bTitle.set(it.title);
    this.bSub.set(it.sub);
    this.bReward.set(it.reward);
    replayClass(this.banner, 'is-on');
    this.bTime = 0;
  }

  private showNeedle(it: NeedleItem): void {
    this.nCount.set(`Needle ${it.index + 1}/${NEEDLE_COUNT}`);
    setIcon(this.nBuffIc, it.buffIcon);
    this.nBuff.set(it.buffName);
    this.nDesc.set(it.buffDesc);
    this.nReward.set(rewardText(it.money, it.wp));
    this.nBy.set(FOUND_BY[it.by]);
    this.nFinal.style.display = it.index + 1 >= NEEDLE_COUNT ? '' : 'none';
    this.needle.classList.remove('is-out');
    replayClass(this.needle, 'is-on');
    this.nTime = 0;
  }

  destroy(): void { this.banner.remove(); this.needle.remove(); }
}
