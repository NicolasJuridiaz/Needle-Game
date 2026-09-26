import * as THREE from 'three';
import { COLORS } from '../palette';
import type { ItemModelKind } from './api';
import { C } from './kit';
import { lumpify, Parts, rng } from './parts';
import { baleParts } from './processing';

/**
 * Belt item geometries for instancing (one InstancedMesh per item type). Each geometry sits ON the belt:
 * base at y = 0, centred in X/Z, long axis along +X (travel direction). Attributes: position, normal,
 * uv (atlas solid blocks) and color, so it renders with paletteMaterial() or modelMaterial().
 *   item:hay            lumpy straw clump (~0.46 × 0.24 × 0.4)
 *   item:bale           twine-bound bale (0.55 × 0.36 × 0.42)
 *   item:wrapped        white film-wrapped bale
 *   item:wrappedPremium wrapped bale with gold stripes
 */

function hayClump(): THREE.BufferGeometry {
  const p = new Parts();
  const g = new THREE.IcosahedronGeometry(0.2, 1);
  lumpify(g, 0.16, 7);
  g.scale(1.15, 0.62, 1.0);
  g.translate(0, 0.11, 0);
  p.add('matte', g, C.hay);
  const lump2 = lumpify(new THREE.IcosahedronGeometry(0.11, 0), 0.2, 9);
  lump2.translate(0.1, 0.17, 0.06);
  p.add('matte', lump2, C.hayLight);
  // loose straws poking out
  const r = rng(3);
  for (let i = 0; i < 9; i++) {
    const a = r() * Math.PI * 2;
    const len = 0.14 + r() * 0.12;
    p.box('matte', [len, 0.012, 0.012], i % 2 ? C.hayLight : C.hayDark, {
      pos: [Math.cos(a) * 0.17, 0.08 + r() * 0.12, Math.sin(a) * 0.15],
      rot: [0, -a, (r() - 0.5) * 0.9],
    });
  }
  const out = p.build().main!;
  // light from above, darker crevices
  const pos = out.getAttribute('position');
  const col = out.getAttribute('color');
  const rr = rng(11);
  for (let i = 0; i < pos.count; i++) {
    const f = 0.78 + 0.34 * Math.min(1, pos.getY(i) / 0.24) + (rr() - 0.5) * 0.12;
    col.setXYZ(i, Math.min(1, col.getX(i) * f), Math.min(1, col.getY(i) * f), Math.min(1, col.getZ(i) * f));
  }
  return out;
}

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
    case 'item:hay': return hayClump();
    case 'item:bale': return bale();
    case 'item:wrapped': return wrapped(false);
    case 'item:wrappedPremium': return wrapped(true);
  }
}
