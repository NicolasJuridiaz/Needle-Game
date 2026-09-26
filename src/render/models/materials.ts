import * as THREE from 'three';
import { atlasTextures } from './atlas';

/**
 * Shared materials of the model library. Every static and animated model part renders with ONE
 * vertex-coloured atlas material: plain parts sample white solid blocks (colour from the vertex colour,
 * roughness / metalness from the ORM map), decals sample their label regions and glow blocks light up
 * through the emissive layer. One program, one texture set, a handful of draw calls per machine.
 */

let _model: THREE.MeshStandardMaterial | null = null;

export function modelMaterial(): THREE.MeshStandardMaterial {
  if (_model) return _model;
  const t = atlasTextures();
  _model = new THREE.MeshStandardMaterial({
    name: 'models.atlas',
    vertexColors: true,
    map: t.map,
    emissiveMap: t.emissive,
    emissive: 0xffffff,
    emissiveIntensity: 1.35,
    roughnessMap: t.orm,
    metalnessMap: t.orm,
    roughness: 1,
    metalness: 1,
  });
  return _model;
}

let _glow: THREE.MeshBasicMaterial | null = null;
/** Unlit vertex-coloured material for animated light effects that are always fully bright. */
export function glowMaterial(): THREE.MeshBasicMaterial {
  if (!_glow) _glow = new THREE.MeshBasicMaterial({ name: 'models.glow', vertexColors: true, toneMapped: false });
  return _glow;
}

const _additive = new Map<number, THREE.MeshBasicMaterial>();
/**
 * Additive translucent material for beams, flames and flashes, pooled by colour and opacity step so
 * instances can change intensity by swapping references (no per-frame allocation).
 */
export function additiveMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
  const step = Math.max(0, Math.min(16, Math.round(opacity * 16)));
  const key = color * 32 + step;
  let m = _additive.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      name: 'models.additive', color, transparent: true, opacity: step / 16, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    _additive.set(key, m);
  }
  return m;
}

let _belt: THREE.MeshStandardMaterial | null = null;
let _beltTex: THREE.Texture | null = null;

/**
 * Rubber belt texture (tiles along V = travel direction): cleats and grime. Used by the conveyor ghost /
 * gallery models; the in-game BeltView owns its own scrolling belt material.
 */
export function beltTexture(): THREE.Texture {
  if (_beltTex) return _beltTex;
  if (typeof document === 'undefined') { _beltTex = new THREE.Texture(); return _beltTex; }
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2a2a2a'; g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 90; i++) { g.fillStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.25)'; g.fillRect((i * 37) % 64, (i * 23) % 64, 2, 1); }
  for (let k = 0; k < 2; k++) {
    const y = 8 + k * 32;
    g.fillStyle = '#171717'; g.fillRect(4, y, 56, 7);
    g.fillStyle = '#3d3d3d'; g.fillRect(4, y, 56, 2);
  }
  g.fillStyle = '#e2b857'; g.globalAlpha = 0.18; g.fillRect(0, 0, 3, 64); g.fillRect(61, 0, 3, 64); g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  _beltTex = t;
  return t;
}

export function beltMaterial(): THREE.MeshStandardMaterial {
  if (!_belt) _belt = new THREE.MeshStandardMaterial({ name: 'models.belt', map: beltTexture(), roughness: 0.85, metalness: 0 });
  return _belt;
}
