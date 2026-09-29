import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ModelInstance } from './api';
import type { MachineStatus } from '../../sim/types';
import { Parts, shade } from './parts';
import { modelMaterial } from './materials';
import { baleParts } from './processing';
import { ports } from './kit';

/** A small timber merchant built around the existing intake. Local +X faces the hall.
 * The 3 × 4 m footprint and all automation ports are unchanged. */
export class SellerStall implements ModelInstance {
  readonly root = new THREE.Group();
  private readonly owned: { dispose(): void }[] = [];
  private readonly pointer = new THREE.Group();
  private needle = 0;

  constructor() {
    this.root.name = 'seller-stall';
    const wood: THREE.BufferGeometry[] = [];
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, tint = 1, rz = 0) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.rotateZ(rz); g.translate(x, y, z);
      const color = new THREE.Color().setScalar(tint);
      const a = new Float32Array(g.getAttribute('position').count * 3);
      for (let i = 0; i < a.length; i += 3) { a[i] = color.r; a[i + 1] = color.g; a[i + 2] = color.b; }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3)); wood.push(g);
    };
    // Individual uneven planks, dark joints and exposed beams give the booth its silhouette.
    for (let i = 0; i < 19; i++) {
      const z = -1.84 + i * .202;
      box(.1, 2.85, .193, -1.39, 1.43, z, .82 + (i % 5) * .055);
    }
    for (const z of [-1.88, 1.88]) {
      for (const x of [-1.32, 1.28]) box(.17, 2.85, .17, x, 1.425, z, .7);
      // Short end wall above the existing low conveyor ports.
      for (let i = 0; i < 11; i++) box(.23, 1.48, .085, -1.22 + i * .242, 1.86, z, .92 + (i % 3) * .065);
      box(2.75, .18, .19, -.02, 2.68, z, .7);
    }
    box(.19, .2, 3.95, 1.28, 2.68, 0, .7);
    box(.19, .2, 3.95, -1.32, 2.86, 0, .7);
    // Counter is raised on legs: every input lane stays visibly open beneath it.
    box(.77, .13, 3.46, .79, 1.13, .05, 1.22);
    for (let j = 0; j < 17; j++) box(.055, .31, .195, 1.19, .91, -1.53 + j * .2, .88 + (j % 4) * .05);
    for (const z of [-1.72, 1.72]) box(.13, .98, .13, .69, .52, z, .64);
    // Shelves, small crates and a rail across the back, all merged into the timber mesh.
    for (const y of [1.15, 1.77, 2.26]) box(.48, .07, 3.35, -1.09, y, 0, 1.08);
    for (const z of [-.88, .73]) {
      box(.42, .43, .64, -1.02, 1.4, z, 1.08);
      for (const dz of [-.31, .31]) box(.025, .43, .065, -.797, 1.4, z + dz, .72);
      box(.024, .065, .62, -.791, 1.25, z, .74);
      box(.024, .065, .62, -.791, 1.56, z, .74);
    }
    // Large real fascia; the lettering occupies the wood face instead of a floating UI plane.
    box(.13, .52, 3.9, 1.40, 2.98, 0, 1.45);
    for (const z of [-1.92, 1.92]) box(.16, .56, .06, 1.41, 2.98, z, .8);
    box(.16, .035, 3.92, 1.41, 2.72, 0, .65);
    box(.16, .035, 3.92, 1.41, 3.245, 0, .65);
    // Freestanding wooden intake marker, next to the actual receiving mouth.
    box(.065, 1.30, .075, .05, .65, -1.92, .68);
    box(.94, .31, .055, .05, 1.44, -1.94, .92);
    const wg = mergeGeometries(wood); wood.forEach(g => g.dispose());
    if (wg) this.mesh(wg, this.woodMaterial());

    const p = new Parts();
    const steel = 0x535957, dark = 0x282e2c, edge = 0x858b83;
    // Corrugated lean-to roof. Simple ribs, no repeating high-poly cylinders.
    for (let k = 0; k < 19; k++) {
      const z = -1.92 + k * .213;
      p.box('metal', [2.95, .035, .205], shade(steel, .8 + (k % 4) * .07), { pos: [-.03, 3.10, z], rot: [0, 0, -.07] });
      p.box('metal', [2.95, .032, .022], 0x686b61, { pos: [-.03, 3.13, z -.09], rot: [0, 0, -.07] });
    }
    // Pegs, roof brackets, warm task lamp and some genuine warehouse props.
    for (const z of [-1.76, 1.76]) {
      p.rod('metal', [1.27, 2.14, z], [.77, 2.66, z], .028, dark, 6);
      for (const y of [.88, 2.55]) p.cyl('metal', .031, .031, .015, edge, { pos: [1.382, y, z] }, 8, 'x');
    }
    p.box('metal', [.19, .10, .95], dark, { pos: [-.43, 2.7, .05] });
    p.box('glowWarm', [.16, .016, .83], 0xffe5a6, { pos: [-.43, 2.642, .05] });
    // The low automation receiving gallery uses exactly the old port definitions.
    const gallery = new Parts();
    ports(gallery, 'sellStation', undefined, { accent: steel, depth: .015 });
    const mouths = gallery.build().main;
    // Low mouths keep the exact belt-height sills and port positions beneath the counter.
    mouths?.translate(0, -.45, 0).scale(1, .50, 1).translate(0, .45, 0);
    p.box('matte', [2.35, .04, 3.60], 0x282c29, { pos: [-.1, .31, 0] });
    // Manual belt arrives at x=-1, z=-2. The dark opening surrounds its actual endpoint.
    for (const x of [-1.47, -.53]) p.box('metal', [.055, .67, .32], steel, { pos: [x, .77, -1.85] });
    p.box('metal', [.99, .075, .38], edge, { pos: [-1, 1.085, -1.82] });
    for (let i = 0; i < 5; i++) p.box('matte', [.177, .49, .023], 0x222820, { pos: [-1.38 + i * .19, .82, -1.90] });
    // A receiving pan visually continues the manual belt inside the timber booth.
    p.box('matte', [.81, .035, .68], 0x202520, { pos: [-1, .45, -1.65] });
    for (const x of [-1.46, -.54]) p.box('metal', [.04, .16, .68], edge, { pos: [x, .51, -1.65] });
    baleParts(p, .65, .42, .56, 0, -.95, 1.1, .075);
    baleParts(p, .60, .40, .52, 0, -.95, 1.05, .5);
    // Small sacks/tins on the back shelf; restrained cream and oxidised metal.
    for (let i = 0; i < 5; i++) {
      p.cyl('metal', .095, .095, .21 + (i % 2) * .07, i % 2 ? 0x838273 : 0x777c73, { pos: [-1.04, 1.91, -.9 + i * .39] }, 8);
    }
    // Cash register, receipt pad, inset display. Display itself is updated by MarketIntakeView from sale events.
    p.bev('metal', [.40, .26, .48], .018, 0x343831, { pos: [.72, 1.32, .22] });
    p.box('metal', [.43, .07, .54], 0x5e6256, { pos: [.73, 1.21, .22] });
    p.box('matte', [.014, .105, .33], 0x17201a, { pos: [.93, 1.39, .22] });
    p.box('matte', [.28, .02, .26], 0xd3c9ad, { pos: [.72, 1.21, .79] });
    for (let k = 0; k < 4; k++) p.box('paint', [.08, .027, .067], 0xbcb8a8, { pos: [.925, 1.245, .1 + k * .081] });

    // Prominent antique scale beside the receiving end. Face is toward +X / arriving player.
    const gx = 1.08, gy = 1.97, gz = -1.13;
    p.bev('metal', [.53, .10, .5], .022, dark, { pos: [gx, .07, gz] });
    p.cyl('metal', .062, .084, 1.65, steel, { pos: [gx, .89, gz] }, 10);
    p.cyl('metal', .50, .50, .12, 0x514c3c, { pos: [gx, gy, gz] }, 48, 'x');
    p.cyl('metal', .472, .472, .018, 0x95866a, { pos: [gx + .07, gy, gz] }, 48, 'x');
    p.cyl('metal', .034, .034, .026, 0x342c20, { pos: [gx + .105, gy, gz] }, 12, 'x');
    const built = p.build();
    if (built.main && mouths) {
      const combined = mergeGeometries([built.main, mouths]);
      built.main.dispose(); mouths.dispose();
      if (combined) this.mesh(combined, modelMaterial(), false);
    } else if (built.main) this.mesh(built.main, modelMaterial(), false);
    const sign = this.canvasMaterial(1024, 160, (g, w, h) => {
      g.fillStyle = '#c3ad7f'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 250; i++) { g.fillStyle = i % 3 ? '#ad966c35' : '#66523520'; g.fillRect((i * 61) % w, (i * 37) % h, 35 + i % 115, 1); }
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#24271f';
      g.font = 'bold 120px Georgia, serif'; g.fillText('SELL HAY', w / 2, h * .54, w * .92);
    });
    this.plane(sign, 3.73, .44, [1.472, 2.98, 0]);
    const haySign = this.canvasMaterial(512, 160, (g, w, h) => {
      g.fillStyle = '#b5a077'; g.fillRect(0, 0, w, h); g.strokeStyle = '#6a5a3e'; g.lineWidth = 7; g.strokeRect(5, 5, w-10, h-10);
      g.fillStyle = '#242920'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 88px Georgia, serif'; g.fillText('HAY IN', w/2, h/2);
    });
    // Just above the intake, visible obliquely from the sell drop pad.
    this.plane(haySign, .90, .29, [.05, 1.44, -1.971], Math.PI / 2);
    const dial = this.canvasMaterial(512, 512, (g, w, h) => {
      g.clearRect(0,0,w,h); g.fillStyle = '#d9d1ac'; g.beginPath(); g.arc(256,256,251,0,Math.PI*2); g.fill();
      g.strokeStyle = '#35392d'; g.fillStyle = '#33392e'; g.lineWidth = 2; g.textAlign = 'center'; g.textBaseline = 'middle';
      for(let i=0;i<=50;i++) {
        const a = -Math.PI * .75 + (i / 50) * Math.PI * 1.5;
        const sx = Math.sin(a), sy = -Math.cos(a); const major = i%5===0;
        g.beginPath(); g.moveTo(256+sx*222,256+sy*222); g.lineTo(256+sx*(major?196:210),256+sy*(major?196:210)); g.stroke();
        if(major) {g.font='22px Georgia,serif'; g.fillText(String(i*2),256+sx*175,256+sy*175);}
      }
      g.font='bold 20px Georgia,serif'; g.fillText('HAY WEIGHING',256,315); g.font='15px Georgia,serif'; g.fillText('TRADE SCALE',256,340);
      g.fillStyle='#333b2d'; g.fillRect(181,365,150,40); g.fillStyle='#d7cd9e'; g.font='18px monospace'; g.fillText('READY',256,386);
    });
    dial.alphaTest = .5;
    this.plane(dial, .9, .9, [gx + .083, gy, gz]);
    this.pointer.name = 'seller-scale-needle';
    this.pointer.position.set(gx + .101, gy, gz);
    const ng = new THREE.BoxGeometry(.01,.35,.014).translate(0,.16,0);
    const nm = new THREE.MeshStandardMaterial({color:0x7e3525,roughness:.7}); this.owned.push(nm);
    this.mesh(ng,nm,false,this.pointer); this.root.add(this.pointer);
    const lamp = new THREE.PointLight(0xffe3b6, 1.35, 4.3, 2); lamp.position.set(.12,2.35,.2); this.root.add(lamp);
    this.update({},0,0);
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, ownMat = true, parent: THREE.Object3D = this.root): void {
    const mesh = new THREE.Mesh(geo, mat); mesh.castShadow=true; mesh.receiveShadow=true; parent.add(mesh);
    this.owned.push(geo); if(ownMat) this.owned.push(mat);
  }
  private woodMaterial(): THREE.MeshStandardMaterial {
    const mat = this.canvasMaterial(256,512,(g,w,h)=>{
      g.fillStyle='#76644b'; g.fillRect(0,0,w,h);
      for(let i=0;i<360;i++) {
        g.strokeStyle=i%3?'#2f2b2340':'#d8bb8530'; g.lineWidth=i%7===0?2:1; g.beginPath();
        const x=(i*79)%w; const y=(i*131)%h;
        g.moveTo(x,y); g.bezierCurveTo(x+6,y+35,x-5,y+96,x+2,y+160); g.stroke();
      }
      for(let i=0;i<8;i++){g.strokeStyle='#39312650';g.lineWidth=1;g.beginPath();g.ellipse((i*43)%w,(i*71)%h,2+i%3,16+i*2,.03,0,Math.PI*2);g.stroke();}
    });
    mat.vertexColors=true; mat.roughness=.97; return mat;
  }
  private canvasMaterial(w:number,h:number,draw:(g:CanvasRenderingContext2D,w:number,h:number)=>void):THREE.MeshStandardMaterial {
    const m=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.88,metalness:0});
    if(typeof document!=='undefined') {const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');if(g){draw(g,w,h);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;this.owned.push(t);m.map=t;}}
    this.owned.push(m);return m;
  }
  private plane(mat:THREE.Material,w:number,h:number,pos:[number,number,number],turn=0):void {
    const geo=new THREE.PlaneGeometry(w,h),m=new THREE.Mesh(geo,mat);m.position.set(...pos);m.rotation.y=Math.PI/2+turn;m.receiveShadow=true;this.root.add(m);this.owned.push(geo);
  }
  update(anim:Record<string,number>,dt:number,_time:number):void {
    const pulse=Math.max(0,Math.min(1,anim.pulse??0));
    this.needle+=(pulse-this.needle)*(1-Math.exp(-Math.max(0,dt)*17));
    this.pointer.rotation.x=Math.PI*.73-this.needle*Math.PI*1.25;
  }
  setStatus(_status:MachineStatus):void { /* The existing scale reacts to the simulation's sale pulse. */ }
  dispose():void { for(const r of new Set(this.owned))r.dispose();this.root.removeFromParent(); }
}
