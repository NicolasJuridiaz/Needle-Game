/**
 * Render quality presets. These are presentation budgets (resolution, shadow maps, instance caps),
 * not gameplay balance, so they live in the render layer.
 */
export type Quality = 'low' | 'medium' | 'high';

export interface QualityProfile {
  /** Upper bound for the canvas pixel ratio (min(devicePixelRatio, this)). */
  readonly pixelRatio: number;
  /** MSAA on the default framebuffer (only applied when the renderer is created). */
  readonly antialias: boolean;
  /** Directional sun shadows. */
  readonly shadows: boolean;
  readonly shadowMapSize: number;
  /** PCF filter radius in shadow-map texels (soft penumbra). */
  readonly shadowRadius: number;
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
  /** Anisotropic filtering level requested for ground textures. */
  readonly anisotropy: number;
}

export const QUALITY_PROFILES: Readonly<Record<Quality, QualityProfile>> = {
  high: {
    pixelRatio: 2, antialias: true, shadows: true, shadowMapSize: 2048, shadowRadius: 2.5, lamps: 4,
    tufts: 4000, tuftsPerCell: 3, tuftDensity: 2.2, particles: 1500, floorTexture: 2048, motes: 700,
    lightShafts: true, anisotropy: 8,
  },
  medium: {
    pixelRatio: 1.5, antialias: false, shadows: true, shadowMapSize: 1024, shadowRadius: 1.6, lamps: 3,
    tufts: 2000, tuftsPerCell: 2, tuftDensity: 1.15, particles: 900, floorTexture: 2048, motes: 400,
    lightShafts: true, anisotropy: 4,
  },
  low: {
    pixelRatio: 1, antialias: false, shadows: false, shadowMapSize: 512, shadowRadius: 1, lamps: 2,
    tufts: 800, tuftsPerCell: 1, tuftDensity: 0.45, particles: 400, floorTexture: 1024, motes: 0,
    lightShafts: false, anisotropy: 1,
  },
};

export function qualityProfile(q: Quality): QualityProfile {
  return QUALITY_PROFILES[q] ?? QUALITY_PROFILES.high;
}
