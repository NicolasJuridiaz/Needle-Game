import type { ItemType } from '../sim/types';

/**
 * ORDERS — contracts on the Order Board. Max 3 visible at a time.
 * They teach systems, give short-term goals and are the main source of Work Points.
 *
 * Metric kinds:
 *  - cumulative (counted from the moment the order becomes active):
 *      sell (item), sellViaBelt (hay-eq delivered by belts/ports), extractManual, extractMachine, extractArm,
 *      burn, scan
 *  - instant (checked continuously, completes when condition holds):
 *      needles (total found), poweredMachines (running powered machines), powerGen (P generated),
 *      siloStored (hay-eq in silos), stableRate (avg delivered hay-eq/s over BALANCE.stableWindow),
 *      pileProgress (0..1 removed)
 */
export type OrderMetric =
  | 'sell' | 'sellViaBelt' | 'extractManual' | 'extractMachine' | 'extractArm' | 'burn' | 'scan'
  | 'needles' | 'poweredMachines' | 'powerGen' | 'siloStored' | 'stableRate' | 'pileProgress';

export interface OrderDef {
  id: string;
  title: string;
  /** Client name for flavour. */
  client: string;
  metric: OrderMetric;
  item?: ItemType;
  target: number;
  reward: { money: number; wp: number };
  /** Becomes available when all these orders are completed. */
  after: string[];
  /** One-line hint pointing at the tech/system that helps. */
  hint: string;
}

export const ORDERS: OrderDef[] = [
  { id: 'o_first', title: 'First Delivery', client: 'Old Mabel\'s Feed Store', metric: 'sell', item: 'hay', target: 60,
    reward: { money: 30, wp: 1 }, after: [], hint: 'Grab hay, then press E at the Market Chute.' },
  { id: 'o_cleanup', title: 'Barn Cleanup', client: 'Old Mabel\'s Feed Store', metric: 'sell', item: 'hay', target: 300,
    reward: { money: 120, wp: 2 }, after: ['o_first'], hint: 'A Shovel scoops 3x more than your hands.' },
  { id: 'o_dig', title: 'Dig Deeper', client: 'Haystack Heritage Society', metric: 'extractManual', target: 900,
    reward: { money: 200, wp: 2 }, after: ['o_first'], hint: 'Any hand tool counts. Bigger tools, faster progress.' },
  { id: 'o_feed', title: 'Feed Store Restock', client: 'Old Mabel\'s Feed Store', metric: 'sell', item: 'hay', target: 1500,
    reward: { money: 500, wp: 3 }, after: ['o_cleanup'], hint: 'A Wheelbarrow carries 200 hay per trip.' },
  { id: 'o_shiny', title: 'Something Shiny', client: 'Lost & Found Office', metric: 'needles', target: 1,
    reward: { money: 600, wp: 2 }, after: ['o_dig'], hint: 'Unlock the Metal Detector (Work Tree > Player & Tools).' },
  { id: 'o_truck', title: 'Truckload', client: 'Valley Stables', metric: 'sell', item: 'hay', target: 2000,
    reward: { money: 1200, wp: 3 }, after: ['o_feed'], hint: 'The Vacuum Tool never stops sucking.' },
  { id: 'o_stoke', title: 'Stoke the Fire', client: 'County Power Co-op', metric: 'burn', target: 100,
    reward: { money: 900, wp: 3 }, after: ['o_feed'], hint: 'Hay Generator (Power & Factory). Feed it with E.' },
  { id: 'o_iron', title: 'Iron Workers', client: 'Haystack Heritage Society', metric: 'extractMachine', target: 3000,
    reward: { money: 1600, wp: 3 }, after: ['o_feed'], hint: 'A powered Piston Rake digs for you.' },
  { id: 'o_handsoff', title: 'Hands Off', client: 'Valley Stables', metric: 'sellViaBelt', target: 3000,
    reward: { money: 2200, wp: 4 }, after: ['o_iron'], hint: 'Hopper + Conveyor into the Market Chute.' },
  { id: 'o_powered', title: 'Power Grid', client: 'County Power Co-op', metric: 'poweredMachines', target: 3,
    reward: { money: 2000, wp: 3 }, after: ['o_stoke'], hint: 'Power Poles spread power across the floor.' },
  { id: 'o_wholesale', title: 'Wholesale', client: 'Mega Mart Livestock', metric: 'sell', item: 'hay', target: 20000,
    reward: { money: 4000, wp: 4 }, after: ['o_handsoff'], hint: 'Split rake output: some to sell, some to burn.' },
  { id: 'o_robots', title: 'Robot Friends', client: 'Automation Weekly', metric: 'extractArm', target: 10000,
    reward: { money: 4500, wp: 4 }, after: ['o_handsoff'], hint: 'Robotic Arms drop hay straight onto belts.' },
  { id: 'o_quality', title: 'Quality Control', client: 'Lost & Found Office', metric: 'scan', target: 5000,
    reward: { money: 3500, wp: 4 }, after: ['o_powered'], hint: 'Put a Needle Scanner on a belt line.' },
  { id: 'o_bales', title: 'Compressed Goods', client: 'Valley Stables', metric: 'sell', item: 'bale', target: 40,
    reward: { money: 5000, wp: 5 }, after: ['o_wholesale'], hint: 'Compressor: 40 hay -> 1 bale.' },
  { id: 'o_steady', title: 'Steady Flow', client: 'Mega Mart Livestock', metric: 'stableRate', target: 45,
    reward: { money: 6000, wp: 4 }, after: ['o_robots'], hint: 'Deliver 45 hay/s for a full minute. Balance your lines.' },
  { id: 'o_stockpile', title: 'Stockpile', client: 'County Winter Reserve', metric: 'siloStored', target: 1000,
    reward: { money: 5500, wp: 4 }, after: ['o_bales'], hint: 'Silos buffer between fast and slow machines.' },
  { id: 'o_bigscan', title: 'Big Scan', client: 'Lost & Found Office', metric: 'scan', target: 25000,
    reward: { money: 9000, wp: 5 }, after: ['o_quality', 'o_steady'], hint: 'Split the line into two scanners.' },
  { id: 'o_balerush', title: 'Bale Rush', client: 'Valley Stables', metric: 'sell', item: 'bale', target: 150,
    reward: { money: 12000, wp: 5 }, after: ['o_stockpile'], hint: 'Double Chamber presses two bales at once.' },
  { id: 'o_wrapped', title: 'Wrapped & Ready', client: 'Gourmet Goat Co.', metric: 'sell', item: 'wrapped', target: 15,
    reward: { money: 14000, wp: 6 }, after: ['o_balerush'], hint: 'Bale Wrapper (Processing & Economy).' },
  { id: 'o_industrial', title: 'Industrial Power', client: 'County Power Co-op', metric: 'powerGen', target: 200,
    reward: { money: 15000, wp: 5 }, after: ['o_bigscan'], hint: 'Upgrade generators or build more of them.' },
  { id: 'o_throttle', title: 'Full Throttle', client: 'Mega Mart Livestock', metric: 'stableRate', target: 75,
    reward: { money: 25000, wp: 6 }, after: ['o_industrial'], hint: 'Vacuum Collectors + wide belts + more scanners.' },
  { id: 'o_premium', title: 'Premium Contract', client: 'Gourmet Goat Co.', metric: 'sell', item: 'wrapped', target: 80,
    reward: { money: 40000, wp: 7 }, after: ['o_wrapped'], hint: 'Premium Wrap makes every bale shine.' },
  { id: 'o_sweep', title: 'Clean Sweep', client: 'Haystack Heritage Society', metric: 'pileProgress', target: 0.85,
    reward: { money: 60000, wp: 8 }, after: ['o_throttle'], hint: 'Only the core of the stack remains. Finish it.' },
];

export const ORDER_BY_ID: Record<string, OrderDef> = Object.fromEntries(ORDERS.map((o) => [o.id, o]));
export const MAX_ACTIVE_ORDERS = 3;
