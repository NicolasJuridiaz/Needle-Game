import type * as THREE from 'three';
import type { Template } from './rig';

/**
 * Geometry caches. Templates (one per model kind + variant) and loose geometries (conveyor tiles, items)
 * are built once on first use and shared by every instance for the lifetime of the page — instances never
 * dispose them.
 */

const templates = new Map<string, Template>();
const geometries = new Map<string, THREE.BufferGeometry>();

export function cachedTemplate(key: string, build: () => Template): Template {
  let t = templates.get(key);
  if (!t) { t = build(); templates.set(key, t); }
  return t;
}

export function cachedGeometry<T extends THREE.BufferGeometry>(key: string, build: () => T): T {
  let g = geometries.get(key) as T | undefined;
  if (!g) { g = build(); geometries.set(key, g); }
  return g;
}

/** Releases every cached GPU geometry (page teardown / hot reload only). */
export function clearModelCaches(): void {
  for (const t of templates.values()) {
    t.main?.dispose(); t.glass?.dispose(); t.rigMain?.dispose(); t.rigGlass?.dispose();
  }
  for (const g of geometries.values()) g.dispose();
  templates.clear();
  geometries.clear();
}
