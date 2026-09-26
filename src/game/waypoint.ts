import * as THREE from 'three';

/** Bouncing arrow that points at the current onboarding target (e.g. the Market Chute). */
export class Waypoint {
  readonly root = new THREE.Group();
  private arrow: THREE.Mesh;
  private ring: THREE.Mesh;
  private visible = false;
  private fade = 0;

  constructor(scene: THREE.Scene) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xf2c14e, transparent: true, opacity: 0.95, depthTest: false });
    const cone = new THREE.ConeGeometry(0.42, 0.8, 4);
    cone.rotateX(Math.PI);
    const shaft = new THREE.CylinderGeometry(0.13, 0.13, 0.7, 6).translate(0, 0.72, 0);
    this.arrow = new THREE.Mesh(cone, mat);
    const shaftMesh = new THREE.Mesh(shaft, mat);
    this.arrow.add(shaftMesh);
    this.arrow.renderOrder = 999;
    shaftMesh.renderOrder = 999;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.72, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xf2c14e, transparent: true, opacity: 0.5, depthTest: false, side: THREE.DoubleSide }));
    this.ring.renderOrder = 998;
    this.root.add(this.arrow, this.ring);
    this.root.visible = false;
    scene.add(this.root);
  }

  set(target: { x: number; y: number; z: number } | null | undefined): void {
    this.visible = !!target;
    if (target) this.root.position.set(target.x, target.y, target.z);
  }

  update(dt: number, time: number): void {
    this.fade += ((this.visible ? 1 : 0) - this.fade) * Math.min(1, dt * 6);
    this.root.visible = this.fade > 0.02;
    if (!this.root.visible) return;
    this.arrow.position.y = Math.sin(time * 3.2) * 0.25 + 0.6;
    this.arrow.rotation.y = time * 1.4;
    this.ring.position.y = -this.root.position.y + 0.05;
    const s = 1 + Math.sin(time * 3.2) * 0.08;
    this.ring.scale.setScalar(s);
    (this.arrow.material as THREE.MeshBasicMaterial).opacity = 0.95 * this.fade;
    (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.5 * this.fade;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.arrow.geometry.dispose();
    (this.arrow.children[0] as THREE.Mesh).geometry.dispose();
    (this.arrow.material as THREE.Material).dispose();
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
  }
}
