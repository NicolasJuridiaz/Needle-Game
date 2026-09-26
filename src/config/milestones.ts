/**
 * MILESTONES — automatic one-off achievements that grant Work Points (and sometimes money).
 * They guarantee a steady WP trickle so the Work Tree always has something reachable.
 */
export type MilestoneMetric =
  | 'haySoldTotal' | 'moneyEarnedTotal' | 'pileProgress' | 'machinesOwned' | 'beltsOwned' | 'firstSale'
  | 'hayScannedTotal' | 'baleSoldTotal' | 'wrappedSoldTotal';

export interface MilestoneDef {
  id: string;
  name: string;
  metric: MilestoneMetric;
  target: number;
  reward: { wp: number; money: number };
}

export const MILESTONES: MilestoneDef[] = [
  { id: 'm_first_sale', name: 'First Sale!', metric: 'firstSale', target: 1, reward: { wp: 1, money: 0 } },
  { id: 'm_sold_200', name: 'Hay Hauler', metric: 'haySoldTotal', target: 200, reward: { wp: 1, money: 0 } },
  { id: 'm_sold_1k', name: 'Hay Merchant', metric: 'haySoldTotal', target: 1000, reward: { wp: 1, money: 0 } },
  { id: 'm_sold_5k', name: 'Hay Tycoon', metric: 'haySoldTotal', target: 5000, reward: { wp: 2, money: 0 } },
  { id: 'm_sold_25k', name: 'Hay Magnate', metric: 'haySoldTotal', target: 25000, reward: { wp: 3, money: 0 } },
  { id: 'm_money_5k', name: 'Pocket Money', metric: 'moneyEarnedTotal', target: 5000, reward: { wp: 1, money: 0 } },
  { id: 'm_money_50k', name: 'Serious Business', metric: 'moneyEarnedTotal', target: 50000, reward: { wp: 2, money: 0 } },
  { id: 'm_money_250k', name: 'Hay Empire', metric: 'moneyEarnedTotal', target: 250000, reward: { wp: 3, money: 0 } },
  { id: 'm_pile_2', name: 'A Dent in the Stack', metric: 'pileProgress', target: 0.02, reward: { wp: 1, money: 0 } },
  { id: 'm_pile_10', name: '10% Cleared', metric: 'pileProgress', target: 0.10, reward: { wp: 2, money: 0 } },
  { id: 'm_pile_25', name: 'Quarter Cleared', metric: 'pileProgress', target: 0.25, reward: { wp: 2, money: 0 } },
  { id: 'm_pile_40', name: '40% Cleared', metric: 'pileProgress', target: 0.40, reward: { wp: 3, money: 0 } },
  { id: 'm_pile_55', name: 'Past Halfway', metric: 'pileProgress', target: 0.55, reward: { wp: 3, money: 0 } },
  { id: 'm_pile_70', name: '70% Cleared', metric: 'pileProgress', target: 0.70, reward: { wp: 3, money: 0 } },
  { id: 'm_machines_1', name: 'First Machine', metric: 'machinesOwned', target: 1, reward: { wp: 1, money: 0 } },
  { id: 'm_machines_8', name: 'Workshop', metric: 'machinesOwned', target: 8, reward: { wp: 2, money: 0 } },
  { id: 'm_machines_20', name: 'Factory', metric: 'machinesOwned', target: 20, reward: { wp: 3, money: 0 } },
  { id: 'm_machines_35', name: 'Industrial Complex', metric: 'machinesOwned', target: 35, reward: { wp: 3, money: 0 } },
  { id: 'm_belts_25', name: 'Belt Layer', metric: 'beltsOwned', target: 25, reward: { wp: 1, money: 0 } },
  { id: 'm_belts_100', name: 'Belt Maze', metric: 'beltsOwned', target: 100, reward: { wp: 2, money: 0 } },
  { id: 'm_scan_5k', name: 'Scanned & Certified', metric: 'hayScannedTotal', target: 5000, reward: { wp: 2, money: 0 } },
  { id: 'm_bales_50', name: 'Baler', metric: 'baleSoldTotal', target: 50, reward: { wp: 2, money: 0 } },
  { id: 'm_wrapped_25', name: 'Gift Wrapper', metric: 'wrappedSoldTotal', target: 25, reward: { wp: 2, money: 0 } },
];
