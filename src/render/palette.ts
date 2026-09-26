import * as THREE from 'three';

/**
 * Shared colour palette + shared materials (render layer). Both the environment and the models use these
 * so the whole game reads as one coherent art style and shares GPU programs.
 * Models encode their colours as VERTEX COLOURS and use `paletteMaterial()` wherever possible.
 */
export const COLORS = {
  // environment
  concrete: 0x8d8a83, concreteDark: 0x6e6b65, wallMetal: 0x9aa3a6, wallMetalDark: 0x6f787c, timber: 0x8a5a33,
  steel: 0x5d676d, steelDark: 0x3b4246, rust: 0x9a5a3a,
  // hay
  hay: 0xe2b857, hayLight: 0xf2d27a, hayDark: 0xb38a35, hayShadow: 0x8a6526,
  // categories
  extraction: 0xe8743b, logistics: 0x4f7fa8, detection: 0x2bb5a8, processing: 0x6aa84f, storage: 0xc9ced1,
  power: 0xc8453b, copper: 0xc07a45, factory: 0xf2c230,
  // details
  rubber: 0x232323, black: 0x1b1b1b, white: 0xf1f1ee, hazardYellow: 0xf2c230, hazardBlack: 0x222222,
  glass: 0x9fd6e8, gold: 0xe6b422, wrapFilm: 0xe9eef2,
  // status lamp colours
  statusGreen: 0x4dff6a, statusAmber: 0xffb020, statusOrange: 0xff7a1a, statusRed: 0xff3030, statusYellow: 0xffe23a, statusOff: 0x444444, statusIdle: 0xcfd8dc,
} as const;

let _palette: THREE.MeshStandardMaterial | null = null;
let _paletteMetal: THREE.MeshStandardMaterial | null = null;
let _glass: THREE.MeshStandardMaterial | null = null;

/** Vertex-coloured, slightly rough material used by most geometry (bake colours into the `color` attribute). */
export function paletteMaterial(): THREE.MeshStandardMaterial {
  if (!_palette) _palette = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.08, flatShading: false });
  return _palette;
}

/** Vertex-coloured metallic variant (steel frames, chrome MK2 parts). */
export function paletteMetalMaterial(): THREE.MeshStandardMaterial {
  if (!_paletteMetal) _paletteMetal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.65 });
  return _paletteMetal;
}

export function glassMaterial(): THREE.MeshStandardMaterial {
  if (!_glass) _glass = new THREE.MeshStandardMaterial({ color: COLORS.glass, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.35, depthWrite: false });
  return _glass;
}

/** Emissive materials are cheap but NOT shared (each lamp needs its own colour). Pool them by colour. */
const _emissive = new Map<number, THREE.MeshStandardMaterial>();
export function emissiveMaterial(color: number, intensity = 1.6): THREE.MeshStandardMaterial {
  const key = color * 10 + Math.round(intensity * 10);
  let m = _emissive.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.4 }); _emissive.set(key, m); }
  return m;
}

/** Paint a whole geometry with one colour into its vertex `color` attribute (for merging). */
export function paintGeometry(geo: THREE.BufferGeometry, color: number | THREE.Color): THREE.BufferGeometry {
  const c = color instanceof THREE.Color ? color : new THREE.Color(color);
  const n = geo.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
