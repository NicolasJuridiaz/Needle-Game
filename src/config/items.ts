import type { ItemType } from '../sim/types';

export interface ItemDef {
  id: ItemType;
  name: string;
  plural: string;
  /** Stat key holding its sale value per unit/item. */
  valueStat: string;
  /** UI colour (hex). */
  color: string;
  icon: string;
}

export const ITEMS: Record<ItemType, ItemDef> = {
  hay: { id: 'hay', name: 'Raw Hay', plural: 'Raw Hay', valueStat: 'econ.hayValue', color: '#e8c35a', icon: 'hay' },
  bale: { id: 'bale', name: 'Hay Bale', plural: 'Hay Bales', valueStat: 'econ.baleValue', color: '#c9a23c', icon: 'bale' },
  wrapped: { id: 'wrapped', name: 'Wrapped Bale', plural: 'Wrapped Bales', valueStat: 'econ.wrappedValue', color: '#e9eef2', icon: 'wrapped' },
};
