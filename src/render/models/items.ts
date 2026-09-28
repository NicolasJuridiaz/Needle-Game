import * as THREE from 'three';
import { COLORS } from '../palette';
import type { ItemModelKind } from './api';
import { C } from './kit';
import { Parts } from './parts';
import { baleParts } from './processing';
import { strawHeapGeometry } from './strawHeap';

/**
 * Belt item geometries for instancing (one InstancedMesh per item type). Each geometry sits ON the belt:
 * base at y = 0, centred in X/Z, long axis along +X (travel direction). Attributes: position, normal,
 * uv (atlas solid blocks) and color, so it renders with paletteMaterial() or modelMaterial().
 *   item:hay, hay1..hay4  straw mini-heaps made of sticks (5 shapes, ~0.4 m wide; see strawHeap.ts)
 *   item:bale           twine-bound bale (0.55 × 0.36 × 0.42)
 *   item:wrapped        white film-wrapped bale
 *   item:wrappedPremium wrapped bale with gold stripes
 */

function bale(): THREE.BufferGeometry {
  const p = new Parts();
  baleParts(p, 0.55, 0.36, 0.42, 0);
  return p.build().main!;
}

function wrapped(premium: boolean): THREE.BufferGeometry {
  const p = new Parts();
  const L = 0.58, H = 0.39, D = 0.45;
  p.round('paint', [L, H, D], 0.07, COLORS.wrapFilm, { pos: [0, H / 2, 0] }, 2);
  // overlapping film seams
  for (const x of [-0.12, 0.1]) p.round('paint', [0.05, H + 0.006, D + 0.006], 0.07, 0xd6dde2, { pos: [x, H / 2, 0] }, 1);
  if (premium) {
    for (const x of [-0.19, 0.19]) p.round('paint', [0.06, H + 0.012, D + 0.012], 0.07, C.gold, { pos: [x, H / 2, 0] }, 1);
    p.round('paint', [L + 0.012, 0.05, D + 0.012], 0.02, C.gold, { pos: [0, H * 0.5, 0] }, 1);
  }
  return p.build().main!;
}

export function buildItemGeometry(kind: ItemModelKind): THREE.BufferGeometry {
  switch (kind) {
    case 'item:hay': return strawHeapGeometry(0);
    case 'item:hay1': return strawHeapGeometry(1);
    case 'item:hay2': return strawHeapGeometry(2);
    case 'item:hay3': return strawHeapGeometry(3);
    case 'item:hay4': return strawHeapGeometry(4);
    case 'item:bale': return bale();
    case 'item:wrapped': return wrapped(false);
    case 'item:wrappedPremium': return wrapped(true);
  }
}
