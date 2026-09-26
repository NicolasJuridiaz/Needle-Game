import * as THREE from 'three';
import { qualityProfile, type Quality } from './quality';
import { PARTICLE_ATLAS_COLS, PARTICLE_ATLAS_ROWS, PARTICLE_SHAPES, particleAtlas, type ParticleShape } from './textures';

/**
 * Parameters of a particle burst. Presets are plain objects meant to be created ONCE (module constants)
 * and reused, so emitting allocates nothing.
 */
export interface ParticlePreset {
  shape: ParticleShape;
  /** Additive layer (sparks, glints, rings) instead of alpha blending. */
  additive?: boolean;
  /** Base colour (sRGB hex). One of `colors` is picked at random when given. */
  color: number;
  colors?: readonly number[];
  /** ±brightness jitter (0..1). */
  colorVar?: number;
  /** Start opacity (default 1). */
  alpha?: number;
  /** Lifetime range (s). */
  life: readonly [number, number];
  /** Start size range (m, world-space diameter). */
  size: readonly [number, number];
  /** End size as a multiple of the start size (default 1). */
  sizeEnd?: number;
  /** Initial speed range (m/s) along a random direction. */
  speed: readonly [number, number];
  /** Extra upward velocity (m/s). */
  up?: number;
  /** Random directions only in the upper hemisphere. */
  hemisphere?: boolean;
  /** Squash of the random direction's vertical component (0 = flat ring, 1 = sphere). */
  vertical?: number;
  /** Gravity (m/s², positive = down). */
  gravity?: number;
  /** Linear drag (1/s). */
  drag?: number;
  /** Max spin (rad/s), random sign. */
  spin?: number;
  /** Spawn position jitter radius (m). */
  radius?: number;
  /** Bounce on the floor (y = 0). */
  bounce?: boolean;
}

const VERT = /* glsl */`
attribute float psize;
attribute vec4 pcolor;
attribute float prot;
attribute float pshape;
uniform float uScale;
varying vec4 vColor;
varying float vRot;
varying vec2 vCell;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = psize * uScale / max(0.05, -mv.z);
  vColor = pcolor;
  vRot = prot;
  vCell = vec2(mod(pshape, ${PARTICLE_ATLAS_COLS}.0), floor(pshape / ${PARTICLE_ATLAS_COLS}.0));
}`;

const FRAG = /* glsl */`
uniform sampler2D uMap;
varying vec4 vColor;
varying float vRot;
varying vec2 vCell;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float c = cos(vRot), s = sin(vRot);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
  if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) discard;
  p = clamp(p, 0.02, 0.98);
  vec2 uv = vec2((vCell.x + p.x) / ${PARTICLE_ATLAS_COLS}.0, 1.0 - (vCell.y + p.y) / ${PARTICLE_ATLAS_ROWS}.0);
  vec4 t = texture2D(uMap, uv);
  gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
  if (gl_FragColor.a < 0.01) discard;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const _c = new THREE.Color();
const _v = new THREE.Vector2();

/** One draw call worth of particles (a Points object) with its CPU simulation state. */
class Layer {
  readonly points: THREE.Points;
  private readonly geo: THREE.BufferGeometry;
  readonly material: THREE.ShaderMaterial;
  readonly cap: number;
  n = 0;
  // GPU
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly rot: Float32Array;
  private readonly shape: Float32Array;
  private readonly aPos: THREE.BufferAttribute;
  private readonly aCol: THREE.BufferAttribute;
  private readonly aSize: THREE.BufferAttribute;
  private readonly aRot: THREE.BufferAttribute;
  private readonly aShape: THREE.BufferAttribute;
  // CPU
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly spin: Float32Array;
  private readonly grav: Float32Array;
  private readonly drag: Float32Array;
  private readonly alpha0: Float32Array;
  private readonly bounce: Uint8Array;

  constructor(cap: number, additive: boolean, map: THREE.Texture) {
    this.cap = Math.max(1, cap);
    const N = this.cap;
    this.pos = new Float32Array(N * 3); this.col = new Float32Array(N * 4); this.size = new Float32Array(N);
    this.rot = new Float32Array(N); this.shape = new Float32Array(N);
    this.vel = new Float32Array(N * 3); this.age = new Float32Array(N); this.life = new Float32Array(N);
    this.size0 = new Float32Array(N); this.size1 = new Float32Array(N); this.spin = new Float32Array(N);
    this.grav = new Float32Array(N); this.drag = new Float32Array(N); this.alpha0 = new Float32Array(N);
    this.bounce = new Uint8Array(N);
    this.geo = new THREE.BufferGeometry();
    const dyn = <T extends THREE.BufferAttribute>(a: T) => a.setUsage(THREE.DynamicDrawUsage) as T;
    this.aPos = dyn(new THREE.BufferAttribute(this.pos, 3));
    this.aCol = dyn(new THREE.BufferAttribute(this.col, 4));
    this.aSize = dyn(new THREE.BufferAttribute(this.size, 1));
    this.aRot = dyn(new THREE.BufferAttribute(this.rot, 1));
    this.aShape = dyn(new THREE.BufferAttribute(this.shape, 1));
    this.geo.setAttribute('position', this.aPos);
    this.geo.setAttribute('pcolor', this.aCol);
    this.geo.setAttribute('psize', this.aSize);
    this.geo.setAttribute('prot', this.aRot);
    this.geo.setAttribute('pshape', this.aShape);
    this.geo.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uMap: { value: map }, uScale: { value: 500 } },
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      toneMapped: !additive,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 11 : 10;
    this.points.name = additive ? 'particles:add' : 'particles';
  }

  spawn(pr: ParticlePreset, x: number, y: number, z: number, vx: number, vy: number, vz: number, scale: number): void {
    let i: number;
    if (this.n < this.cap) i = this.n++;
    else {
      // Full: recycle the oldest-looking slot (cheap: random victim) so new events still read.
      i = (Math.random() * this.cap) | 0;
    }
    const i3 = i * 3, i4 = i * 4;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.age[i] = 0;
    this.life[i] = pr.life[0] + Math.random() * (pr.life[1] - pr.life[0]);
    const s = (pr.size[0] + Math.random() * (pr.size[1] - pr.size[0])) * scale;
    this.size0[i] = s; this.size1[i] = s * (pr.sizeEnd ?? 1); this.size[i] = s;
    this.rot[i] = Math.random() * Math.PI * 2;
    const spin = pr.spin ?? 0;
    this.spin[i] = (Math.random() * 2 - 1) * spin;
    this.grav[i] = pr.gravity ?? 0;
    this.drag[i] = pr.drag ?? 0;
    this.alpha0[i] = pr.alpha ?? 1;
    this.bounce[i] = pr.bounce ? 1 : 0;
    this.shape[i] = PARTICLE_SHAPES[pr.shape];
    const hex = pr.colors && pr.colors.length ? pr.colors[(Math.random() * pr.colors.length) | 0] : pr.color;
    _c.setHex(hex);
    const k = 1 + ((pr.colorVar ?? 0) * (Math.random() * 2 - 1));
    this.col[i4] = _c.r * k; this.col[i4 + 1] = _c.g * k; this.col[i4 + 2] = _c.b * k; this.col[i4 + 3] = 0;
  }

  private kill(i: number): void {
    const last = --this.n;
    if (i === last) return;
    const i3 = i * 3, l3 = last * 3, i4 = i * 4, l4 = last * 4;
    this.pos[i3] = this.pos[l3]; this.pos[i3 + 1] = this.pos[l3 + 1]; this.pos[i3 + 2] = this.pos[l3 + 2];
    this.vel[i3] = this.vel[l3]; this.vel[i3 + 1] = this.vel[l3 + 1]; this.vel[i3 + 2] = this.vel[l3 + 2];
    this.col[i4] = this.col[l4]; this.col[i4 + 1] = this.col[l4 + 1]; this.col[i4 + 2] = this.col[l4 + 2]; this.col[i4 + 3] = this.col[l4 + 3];
    this.size[i] = this.size[last]; this.rot[i] = this.rot[last]; this.shape[i] = this.shape[last];
    this.age[i] = this.age[last]; this.life[i] = this.life[last];
    this.size0[i] = this.size0[last]; this.size1[i] = this.size1[last]; this.spin[i] = this.spin[last];
    this.grav[i] = this.grav[last]; this.drag[i] = this.drag[last]; this.alpha0[i] = this.alpha0[last];
    this.bounce[i] = this.bounce[last];
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.n) {
      const a = this.age[i] + dt;
      const L = this.life[i];
      if (a >= L) { this.kill(i); continue; }
      this.age[i] = a;
      const i3 = i * 3;
      const damp = Math.max(0, 1 - this.drag[i] * dt);
      let vx = this.vel[i3] * damp, vy = this.vel[i3 + 1] * damp - this.grav[i] * dt, vz = this.vel[i3 + 2] * damp;
      let x = this.pos[i3] + vx * dt, y = this.pos[i3 + 1] + vy * dt, z = this.pos[i3 + 2] + vz * dt;
      if (this.bounce[i] && y < 0.02 && vy < 0) { y = 0.02; vy *= -0.3; vx *= 0.6; vz *= 0.6; this.spin[i] *= 0.5; }
      this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
      this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
      const t = a / L;
      this.size[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      this.rot[i] += this.spin[i] * dt;
      const fadeIn = Math.min(1, a / 0.06);
      const fadeOut = 1 - t * t * t;
      this.col[i * 4 + 3] = this.alpha0[i] * fadeIn * fadeOut;
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    this.points.visible = this.n > 0;
    if (this.n > 0) {
      this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; this.aSize.needsUpdate = true;
      this.aRot.needsUpdate = true; this.aShape.needsUpdate = true;
    }
  }

  setScale(s: number): void { this.material.uniforms.uScale.value = s; }

  dispose(): void {
    this.points.removeFromParent();
    this.geo.dispose();
    this.material.dispose();
  }
}

/**
 * Pooled GPU particles: two Points layers (alpha-blended + additive) using the shared particle atlas,
 * simulated on the CPU in flat typed arrays (no per-frame allocation). Live particles are hard-capped by
 * the quality profile (1500 high). Emits far from the camera are skipped.
 */
export class Particles {
  private normal!: Layer;
  private additive!: Layer;
  private readonly map: THREE.Texture;
  private readonly camPos = new THREE.Vector3(0, 1e6, 0);
  /** 1 / (2 tan(fov/2)) of the last camera. */
  private fovScale = 0.9;
  /** Emits further than this from the camera are dropped (m). */
  cullDistance = 55;

  constructor(private readonly scene: THREE.Scene, quality: Quality) {
    this.map = particleAtlas();
    this.build(quality);
  }

  private build(q: Quality): void {
    const cap = qualityProfile(q).particles;
    this.normal = new Layer(Math.round(cap * 0.7), false, this.map);
    this.additive = new Layer(cap - Math.round(cap * 0.7), true, this.map);
    this.scene.add(this.normal.points, this.additive.points);
    // Point size needs the drawing-buffer height, only known at render time.
    const hook: THREE.Object3D['onBeforeRender'] = (renderer) => {
      renderer.getDrawingBufferSize(_v);
      const s = _v.y * this.fovScale;
      this.normal.setScale(s);
      this.additive.setScale(s);
    };
    this.normal.points.onBeforeRender = hook;
    this.additive.points.onBeforeRender = hook;
  }

  setQuality(q: Quality): void {
    this.normal.dispose();
    this.additive.dispose();
    this.build(q);
  }

  /** Live particle count (debug overlay). */
  get count(): number { return this.normal.n + this.additive.n; }

  /** True if a point is close enough to the camera to be worth emitting at. */
  near(x: number, y: number, z: number, dist = this.cullDistance): boolean {
    const dx = x - this.camPos.x, dy = y - this.camPos.y, dz = z - this.camPos.z;
    return dx * dx + dy * dy + dz * dz <= dist * dist;
  }

  /** Emit `count` particles of a preset at (x,y,z). `scale` multiplies sizes. */
  burst(pr: ParticlePreset, x: number, y: number, z: number, count: number, scale = 1): void {
    if (count <= 0 || !this.near(x, y, z)) return;
    const layer = pr.additive ? this.additive : this.normal;
    const r = pr.radius ?? 0;
    const vert = pr.vertical ?? 1;
    const up = pr.up ?? 0;
    for (let k = 0; k < count; k++) {
      // Random unit direction.
      let dx = Math.random() * 2 - 1, dy = Math.random() * 2 - 1, dz = Math.random() * 2 - 1;
      const len = Math.hypot(dx, dy, dz) || 1;
      dx /= len; dy /= len; dz /= len;
      if (pr.hemisphere) dy = Math.abs(dy);
      dy *= vert;
      const sp = pr.speed[0] + Math.random() * (pr.speed[1] - pr.speed[0]);
      layer.spawn(pr,
        x + (Math.random() * 2 - 1) * r, y + (Math.random() * 2 - 1) * r * 0.5, z + (Math.random() * 2 - 1) * r,
        dx * sp, dy * sp + up, dz * sp, scale);
    }
  }

  /** Emit a single particle with an explicit velocity. */
  spawn(pr: ParticlePreset, x: number, y: number, z: number, vx: number, vy: number, vz: number, scale = 1): void {
    if (!this.near(x, y, z)) return;
    (pr.additive ? this.additive : this.normal).spawn(pr, x, y, z, vx, vy, vz, scale);
  }

  /** Advance the simulation; `camera` drives point-size scaling and distance culling. */
  update(dt: number, camera: THREE.Camera): void {
    camera.getWorldPosition(this.camPos);
    const d = Math.min(dt, 0.1);
    this.normal.update(d);
    this.additive.update(d);
    const cam = camera as THREE.PerspectiveCamera;
    if (cam.isPerspectiveCamera) {
      // Pixel height of 1 m at 1 m distance; the drawing-buffer height is read in onBeforeRender.
      this.fovScale = 1 / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    }
  }

  dispose(): void {
    this.normal.dispose();
    this.additive.dispose();
  }
}
