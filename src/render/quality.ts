/**
 * Render quality presets. These are presentation budgets (resolution, shadow maps, instance caps),
 * not gameplay balance, so they live in the render layer. Everything except `antialias` is applied live
 * by the `setQuality` of each view (Renderer, Environment, HayView, BeltView, Particles, PowerWires).
 * Tone mapping (ACES) and the image-based lighting are identical on every preset.
 */
export type Quality = 'low' | 'medium' | 'high';

export const QUALITIES: readonly Quality[] = ['low', 'medium', 'high'];

export interface QualityProfile {
  /** Upper bound for the canvas pixel ratio (min(devicePixelRatio, this)). */
  readonly pixelRatio: number;
  /**
   * Drawing-buffer pixel budget (width × height in device pixels). Very large windows (4K, ultrawide,
   * high-DPR fullscreen) render at a lower pixel ratio instead of paying for every physical pixel.
   */
  readonly maxPixels: number;
  /** MSAA on the default framebuffer. Fixed when the WebGL context is created: needs a page reload. */
  readonly antialias: boolean;
  /** Directional sun shadows (the only shadow-casting light on every preset; lamps never cast). */
  readonly shadows: boolean;
  readonly shadowMapSize: number;
  /** PCF filter radius in shadow-map texels (soft penumbra). */
  readonly shadowRadius: number;
  /** Items riding the belts (hay clumps, bales) cast sun shadows. Belt frames and machines always do. */
  readonly itemShadows: boolean;
  /** Real point lights hung from the trusses (the fixtures always glow). */
  readonly lamps: number;
  /** Straw tuft instance pool size. */
  readonly tufts: number;
  /** Max tuft slots per hay cell. */
  readonly tuftsPerCell: number;
  /** Expected tufts per covered hay cell (≤ tuftsPerCell). */
  readonly tuftDensity: number;
  /** Hard cap on live particles (all layers). */
  readonly particles: number;
  /** Width in pixels of the large non-tiling floor texture. */
  readonly floorTexture: number;
  /** Ambient dust motes drifting in the light shafts. */
  readonly motes: number;
  /** Volumetric-looking light shafts under the skylights. */
  readonly lightShafts: boolean;
  /** Anisotropic filtering level for ground textures (floor, hay pile). */
  readonly anisotropy: number;
  /** Line segments per power cable (catenary smoothness). */
  readonly wireSegments: number;
}

export const QUALITY_PROFILES: Readonly<Record<Quality, QualityProfile>> = {
  high: {
    pixelRatio: 2, maxPixels: 3840 * 2160, antialias: true,
    shadows: true, shadowMapSize: 2048, shadowRadius: 2.5, itemShadows: true, lamps: 4,
    tufts: 4000, tuftsPerCell: 3, tuftDensity: 2.2, particles: 1500, floorTexture: 2048, motes: 700,
    lightShafts: true, anisotropy: 8, wireSegments: 12,
  },
  medium: {
    pixelRatio: 1.5, maxPixels: 2560 * 1440, antialias: false,
    shadows: true, shadowMapSize: 1024, shadowRadius: 1.6, itemShadows: false, lamps: 3,
    tufts: 2000, tuftsPerCell: 2, tuftDensity: 1.15, particles: 900, floorTexture: 2048, motes: 400,
    lightShafts: true, anisotropy: 4, wireSegments: 8,
  },
  low: {
    pixelRatio: 1, maxPixels: 1920 * 1080, antialias: false,
    shadows: false, shadowMapSize: 512, shadowRadius: 1, itemShadows: false, lamps: 2,
    tufts: 800, tuftsPerCell: 1, tuftDensity: 0.45, particles: 400, floorTexture: 1024, motes: 0,
    lightShafts: false, anisotropy: 2, wireSegments: 5,
  },
};

export function qualityProfile(q: Quality): QualityProfile {
  return QUALITY_PROFILES[q] ?? QUALITY_PROFILES.medium;
}

/** Lowest pixel ratio the budget may force (below this the image turns to mush). */
export const MIN_PIXEL_RATIO = 0.5;

/**
 * Canvas pixel ratio for a CSS size: min(devicePixelRatio, profile cap), lowered further (in 0.05 steps)
 * so the drawing buffer stays within `maxPixels`, never below MIN_PIXEL_RATIO. Bad inputs count as DPR 1.
 */
export function effectivePixelRatio(devicePixelRatio: number, cssWidth: number, cssHeight: number, prof: QualityProfile): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  let pr = Math.min(dpr, prof.pixelRatio);
  const w = Number.isFinite(cssWidth) ? Math.max(1, cssWidth) : 1;
  const h = Number.isFinite(cssHeight) ? Math.max(1, cssHeight) : 1;
  const budget = Math.sqrt(prof.maxPixels / (w * h));
  if (pr > budget) pr = Math.floor(budget * 20) / 20;
  return Math.max(MIN_PIXEL_RATIO, pr);
}
