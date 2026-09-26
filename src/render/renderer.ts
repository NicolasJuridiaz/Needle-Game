import * as THREE from 'three';
import { qualityProfile, type Quality } from './quality';

export interface RenderStats { drawCalls: number; triangles: number }

/**
 * Owns the WebGL renderer, the main scene and the first-person camera.
 * - sRGB output, ACES filmic tone mapping, pixel ratio and shadow filtering by quality.
 * - A soft image-based "warehouse" environment (PMREM) so metals and plastics read well everywhere.
 * - Optional overlay pass (first-person viewmodels) rendered after clearing depth.
 * MSAA is fixed when the renderer is created (WebGL limitation); `setQuality` changes everything else.
 */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly container: HTMLElement;

  private quality: Quality;
  private overlayScene: THREE.Scene | null = null;
  private overlayCamera: THREE.Camera | null = null;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private readonly statsOut: RenderStats = { drawCalls: 0, triangles: 0 };
  private width = 1;
  private height = 1;

  constructor(container: HTMLElement, quality: Quality) {
    this.container = container;
    this.quality = quality;
    const prof = qualityProfile(quality);
    this.renderer = new THREE.WebGLRenderer({
      antialias: prof.antialias,
      powerPreference: 'high-performance',
      stencil: false,
      preserveDrawingBuffer: false,
    });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.info.autoReset = false;
    r.domElement.style.display = 'block';
    r.domElement.style.width = '100%';
    r.domElement.style.height = '100%';
    r.domElement.addEventListener('webglcontextlost', this.onContextLost, false);
    container.appendChild(r.domElement);

    this.camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.08, 900);
    this.camera.position.set(0, 1.7, 0);
    this.scene.add(this.camera);

    this.applyQuality(prof.pixelRatio, prof.shadows);
    this.buildEnvironmentMap();
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(container);
    }
  }

  get domElement(): HTMLCanvasElement { return this.renderer.domElement; }
  get currentQuality(): Quality { return this.quality; }

  setFov(v: number): void {
    if (this.camera.fov === v) return;
    this.camera.fov = v;
    this.camera.updateProjectionMatrix();
  }

  /** Match the canvas to the container size (also done automatically through a ResizeObserver). */
  resize(): void {
    const w = Math.max(1, this.container.clientWidth || window.innerWidth);
    const h = Math.max(1, this.container.clientHeight || window.innerHeight);
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    const prof = qualityProfile(q);
    const shadowsChanged = this.renderer.shadowMap.enabled !== prof.shadows;
    this.applyQuality(prof.pixelRatio, prof.shadows);
    if (shadowsChanged) {
      // Shadow receivers compile different programs; force a rebuild of every material once.
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (!m) return;
        for (const x of Array.isArray(m) ? m : [m]) x.needsUpdate = true;
      });
    }
  }

  /** First-person viewmodel pass rendered on top of the world (depth cleared). null disables it. */
  setOverlay(scene: THREE.Scene | null, camera?: THREE.Camera): void {
    this.overlayScene = scene;
    this.overlayCamera = camera ?? null;
  }

  render(): void {
    const r = this.renderer;
    r.info.reset();
    r.render(this.scene, this.camera);
    if (this.overlayScene && this.overlayCamera) {
      r.autoClear = false;
      r.clearDepth();
      r.render(this.overlayScene, this.overlayCamera);
      r.autoClear = true;
    }
  }

  /** Draw calls and triangles of the last `render()` (shadow and overlay passes included). */
  stats(): RenderStats {
    this.statsOut.drawCalls = this.renderer.info.render.calls;
    this.statsOut.triangles = this.renderer.info.render.triangles;
    return this.statsOut;
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost, false);
    this.envTarget?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private applyQuality(pixelRatio: number, shadows: boolean): void {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    this.renderer.setPixelRatio(Math.min(dpr, pixelRatio));
    this.renderer.shadowMap.enabled = shadows;
    this.renderer.shadowMap.needsUpdate = true;
    // setPixelRatio resizes the drawing buffer from the cached CSS size.
    if (this.width > 1 || this.height > 1) this.renderer.setSize(this.width, this.height, false);
  }

  /**
   * Pre-filtered radiance for image-based lighting: warm interior gradient with bright skylight strips
   * overhead and a sunny doorway on the west side. Generated once from a tiny scene.
   */
  private buildEnvironmentMap(): void {
    const envScene = new THREE.Scene();
    const sphere = new THREE.SphereGeometry(10, 32, 16);
    const pos = sphere.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    const top = new THREE.Color(0xf4ead8), mid = new THREE.Color(0x9c8b72), low = new THREE.Color(0x4a3f33);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 10;
      if (y > 0) c.copy(mid).lerp(top, Math.pow(y, 0.7)); else c.copy(mid).lerp(low, Math.min(1, -y * 1.6));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    sphere.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const shell = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide }));
    envScene.add(shell);
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff4dc).multiplyScalar(5) });
    const stripGeo = new THREE.PlaneGeometry(14, 1.2);
    for (const z of [-3.5, 3.5]) {
      const strip = new THREE.Mesh(stripGeo, glow);
      strip.rotation.x = Math.PI / 2;
      strip.position.set(0, 8.5, z);
      envScene.add(strip);
    }
    const doorGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xdfeeff).multiplyScalar(3) });
    const door = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), doorGlow);
    door.rotation.y = Math.PI / 2;
    door.position.set(-9, 0.5, 1);
    envScene.add(door);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTarget = pmrem.fromScene(envScene, 0.035);
    pmrem.dispose();
    envScene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    });
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 0.5;
  }

  private readonly onContextLost = (e: Event): void => {
    // Allow the browser to restore the context; three.js re-uploads resources on restore.
    e.preventDefault();
  };
}
