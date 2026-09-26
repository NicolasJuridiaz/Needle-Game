import { NEEDLE_BUFFS, NEEDLE_COUNT } from '../config/needles';
import type { NeedleState } from '../sim/types';
import { h } from './dom';
import { fmtClock, fmtCompact, fmtInt, fmtMoney, fmtRate } from './format';
import { icon } from './icons';
import { button, escapeHTML, Panel, type PartEnv } from './part';

const HOW: Record<NonNullable<NeedleState['foundBy']>, { label: string; icon: string }> = {
  manual: { label: 'By hand', icon: 'hands' },
  detector: { label: 'Metal Detector', icon: 'detector' },
  scanner: { label: 'Needle Scanner', icon: 'scanner' },
};

/** End-of-run summary: time, needles (when/how), economy and factory stats; Keep Playing / New Run. */
export class Summary extends Panel {
  private readonly headSub: HTMLElement;
  private readonly needles: HTMLElement;
  private readonly stats: HTMLElement;

  constructor(env: PartEnv, parent: HTMLElement) {
    super(env, parent, 'summary', 'pn-summary-screen');
    const ctx = env.ctx;
    const panel = h('div', 'pn-panel pn-summary', this.el);
    const head = h('div', 'pn-sum-head', panel);
    h('div', 'pn-sum-trophy', head).innerHTML = icon('trophy');
    h('div', 'pn-sum-kicker', head, 'Run complete');
    h('div', 'pn-sum-title', head, `All ${NEEDLE_COUNT} needles found!`);
    this.headSub = h('div', 'pn-sum-sub', head);
    const body = h('div', 'pn-sum-body', panel);
    const left = h('div', 'pn-sum-col', body);
    h('div', 'pn-set-title', left, 'The needles');
    this.needles = h('div', 'pn-sum-needles', left);
    const right = h('div', 'pn-sum-col', body);
    h('div', 'pn-set-title', right, 'Your factory');
    this.stats = h('div', 'pn-sum-stats', right);
    const actions = h('div', 'pn-sum-actions', panel);
    button(env, actions, { cls: 'pn-btn--ghost', icon: 'restart', label: 'New Run' }, () => ctx.actions.newGame());
    button(env, actions, { cls: 'pn-btn--primary pn-btn--big', icon: 'play', label: 'Keep Playing' }, () => ctx.actions.continueAfterCompletion());
  }

  protected override onOpen(): void { this.render(); }

  protected tick(): void { /* static content, rendered on open */ }

  private render(): void {
    const sim = this.env.ctx.sim;
    const p = sim.progress;
    const st = p.stats;
    const time = st.completedAt > 0 ? st.completedAt : sim.time;
    this.headSub.textContent = `Finished in ${fmtClock(time)}`;

    let html = '';
    p.needlesFound.forEach((id, k) => {
      const n = sim.hay.needles.find((q) => q.id === id);
      const buff = NEEDLE_BUFFS[k];
      const how = n?.foundBy ? HOW[n.foundBy] : HOW.manual;
      const when = n?.foundAt !== undefined ? fmtClock(n.foundAt) : '--:--';
      const returns = n && n.returns > 0 ? `<span class="pn-sum-ret">slipped ${n.returns}x</span>` : '';
      html += `<div class="pn-sum-needle" style="--k:${k}"><span class="pn-sum-num">${k + 1}</span>` +
        `<span class="pn-sum-buff">${icon(buff?.icon ?? 'needle')}<span><b>${escapeHTML(buff?.name ?? 'Needle')}</b><small>${escapeHTML(buff?.desc ?? '')}</small></span></span>` +
        `<span class="pn-sum-when">${icon('clock')}${when}</span><span class="pn-sum-how">${icon(how.icon)}${how.label}${returns}</span></div>`;
    });
    this.needles.innerHTML = html;

    const tiles: [string, string, string][] = [
      ['money', fmtMoney(st.moneyEarned), 'Money earned'],
      ['hay', fmtCompact(st.haySold), 'Hay sold'],
      ['bale', fmtInt(st.baleSold), 'Bales sold'],
      ['wrapped', fmtInt(st.wrappedSold), 'Wrapped bales sold'],
      ['scanner', fmtCompact(st.hayScanned), 'Hay scanned'],
      ['fire', fmtCompact(st.hayBurned), 'Hay burned'],
      ['speed', `${fmtRate(st.peakThroughput)} hay/s`, 'Peak throughput'],
      ['power', `${fmtInt(st.peakPower)} P`, 'Peak power'],
      ['industrial', fmtInt(st.machinesBuilt), 'Machines built'],
      ['conveyor', fmtInt(st.beltsBuilt), 'Belts built'],
      ['wp', fmtInt(st.wpEarned), 'Work Points earned'],
      ['needle', fmtInt(st.needlesReturned), 'Needles that slipped'],
    ];
    this.stats.innerHTML = tiles.map(([ic, v, l]) => `<div class="pn-sum-stat">${icon(ic)}<b>${v}</b><span>${l}</span></div>`).join('');
  }
}
