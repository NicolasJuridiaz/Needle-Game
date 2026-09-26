import type { BuildingCtor } from '../building';
import type { BuildingType } from '../types';
import { RoboticArm } from './arm';
import { VacuumCollector } from './collector';
import { HayGenerator } from './generator';
import { Compressor, Wrapper } from './processing';
import { PistonRake } from './rake';
import { ScannerMk1, ScannerMk2 } from './scanner';
import { SellStation } from './sellStation';
import { Hopper, Silo } from './storage';

export { RoboticArm, VacuumCollector, HayGenerator, Compressor, Wrapper, PistonRake, ScannerMk1, ScannerMk2, SellStation, Hopper, Silo };

/**
 * Behaviour classes of every non-logistics building. powerPole / platform / stairs have no behaviour
 * (Sim falls back to StaticBuilding; poles are read by the PowerNetwork).
 */
export const MACHINE_CLASSES: Partial<Record<BuildingType, BuildingCtor>> = {
  sellStation: SellStation,
  hopper: Hopper,
  pistonRake: PistonRake,
  roboticArm: RoboticArm,
  vacuumCollector: VacuumCollector,
  scannerMk1: ScannerMk1,
  scannerMk2: ScannerMk2,
  compressor: Compressor,
  wrapper: Wrapper,
  silo: Silo,
  hayGenerator: HayGenerator,
};
