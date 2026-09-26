import type { BuildingCtor } from '../building';
import type { BuildingType } from '../types';
import { BeltLift, Conveyor, ConveyorRamp } from './conveyor';
import { Merger, Splitter, UMerger, USplitter } from './junctions';

/** Logistics building classes (see ARCHITECTURE §4.2). */
export const LOGISTICS_CLASSES: Partial<Record<BuildingType, BuildingCtor>> = {
  conveyor: Conveyor,
  conveyorRamp: ConveyorRamp,
  splitter: Splitter,
  merger: Merger,
  uSplitter: USplitter,
  uMerger: UMerger,
  beltLift: BeltLift,
};

export { LogisticsBuilding } from './base';
export { BeltLift, Conveyor, ConveyorRamp } from './conveyor';
export { Merger, Splitter, UMerger, USplitter, SPLITTER_MODES, FILTER_TYPES } from './junctions';
