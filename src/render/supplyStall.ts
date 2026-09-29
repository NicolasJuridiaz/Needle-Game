import * as THREE from 'three';
import { TOOLS, WHEELBARROW } from '../config/tools';
import type { Progression } from '../sim/progression';
import type { Sim } from '../sim/sim';
import type { ToolId } from '../sim/types';
import { modelMaterial } from './models/materials';
import { Parts, flipFaces, prism, rng, shade, type V3 } from './models/parts';

export interface SupplyPriceRow {
  id: Exclude<ToolId, 'hands'> | 'wheelbarrow';
  label: string;
  cost: number;
  price: string;
  state: 'LOCKED' | 'AVAILABLE' | 'OWNED';
}

/** Read the same definitions and ownership/plan rules as the shop; money never means a plan is locked. */
export function supplyPriceRows(progress: Progression): SupplyPriceRow[] {
  const ids: SupplyPriceRow['id'][] = [
    ...Object.keys(TOOLS).filter((id): id is Exclude<ToolId, 'hands'> => id !== 'hands'),
    'wheelbarrow',
  ];
  return ids.map(id => {
    const def = id === 'wheelbarrow' ? WHEELBARROW : TOOLS[id];
    const owned = id === 'wheelbarrow' ? progress.hasWheelbarrow : progress.ownedTools.has(id);
    const unlocked = def.requiresNode === null || progress.isUnlocked(def.requiresNode);
    return {
      id, label: def.name.toUpperCase(), cost: def.cost,
      price: `$${def.cost.toLocaleString('en-US')}`,
      state: owned ? 'OWNED' : unlocked ? 'AVAILABLE' : 'LOCKED',
    };
  });
}

const TOOL_IDS = Object.keys(TOOLS) as ToolId[];

const WOOD = [0x49392e, 0x584334, 0x604b38, 0x513d30];
const IRON = 0x393a36;
const STEEL = 0x89928b;
const RED = 0x74392e;
const CREAM = 0xe4d6b4;
const FONT = '"Trebuchet MS", Arial, sans-serif';

/** Open timber supply stall. Local +X faces the hall; its back begins at x=0. */
export class SupplyStall {
  readonly root = new THREE.Group();
  private readonly disposables: { dispose(): void }[] = [];
  private readonly board: { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D; texture: THREE.CanvasTexture } | null;
  private priceSignature = '';

  constructor() {
    this.root.name = 'supply-co-stall';
    const p = new Parts();
    const random = rng(4917);
    let plankIndex = 0;
    // Grain, split ends and faded edges are geometry, merged with the timber into one draw call.
    const timber = (size: V3, pos: V3, rot: V3 = [0, 0, 0], color?: number): void => {
      const base = color ?? WOOD[plankIndex++ % WOOD.length];
      const euler = new THREE.Euler(...rot);
      const at = (x: number, y: number, z: number): V3 => {
        const v = new THREE.Vector3(x, y, z).applyEuler(euler);
        return [v.x + pos[0], v.y + pos[1], v.z + pos[2]];
      };
      p.bev('matte', size, 0.009, base, { pos, rot });
      const vertical = size[1] > size[2];
      for (let i = 0; i < 4; i++) {
        const span = (vertical ? size[1] : size[2]) * (0.28 + random() * 0.45);
        const across = (i - 1.5) / 5 * (vertical ? size[2] : size[1]);
        const along = (random() - 0.5) * ((vertical ? size[1] : size[2]) - span);
        p.box('matte', vertical ? [0.003, span, 0.004] : [0.003, 0.004, span], shade(base, i % 2 ? 1.32 : 0.59), {
          pos: at(size[0] / 2 + 0.001, vertical ? along : across, vertical ? across : along), rot,
        });
      }
    };

    // Slatted back and open frame: daylight remains visible around the display, under the counter and roof.
    for (let row = 0; row < 5; row++) timber([0.085, 0.185, 3.4], [0.08, 0.19 + row * 0.205, 0]);
    for (const z of [-1.7, 1.7]) {
      timber([0.16, 2.86, 0.16], [0.17, 1.43, z]);
      timber([0.15, 2.62, 0.15], [0.86, 1.31, z]);
      p.box('metal', [0.17, 0.16, 0.17], IRON, { pos: [0.86, 0.13, z] });
      timber([0.10, 0.69, 0.10], [0.68, 2.38, z], [0, 0, 0.52]);
      for (const y of [0.35, 2.42]) p.bolt([0.945, y, z], [1, 0, 0], 0.022, IRON);
    }
    timber([0.16, 0.17, 3.52], [0.85, 2.57, 0]);
    timber([0.14, 0.14, 3.43], [0.17, 2.8, 0]);
    timber([0.13, 0.16, 3.27], [0.19, 1.91, 0]);
    // Two slim shelves, with open space between them.
    timber([0.45, 0.075, 2.65], [0.35, 1.03, 0.25]);
    timber([0.29, 0.065, 2.63], [0.27, 1.55, 0.25]);

    // Counter: separated boards and a thick worktop with exposed end grain.
    for (let i = 0; i < 8; i++) timber([0.09, 0.76, 0.244], [0.86, 0.48, -0.4 + i * 0.258]);
    for (const z of [-0.45, 1.51]) timber([0.13, 0.95, 0.13], [0.72, 0.5, z]);
    timber([0.13, 0.095, 2.08], [0.905, 0.17, 0.55]);
    for (let i = 0; i < 3; i++) timber([0.23, 0.09, 2.14], [0.32 + i * 0.237, 1.015, 0.55], [0, 0, 0], 0x806244);
    p.box('metal', [0.014, 0.57, 0.055], IRON, { pos: [0.916, 0.49, -0.18] });
    p.box('metal', [0.014, 0.57, 0.055], IRON, { pos: [0.916, 0.49, 1.3] });

    // Sloped, faded burgundy awning, with narrow standing seams and a shallow scallop-free valance.
    for (let i = 0; i < 12; i++) {
      const z = -1.7325 + i * 0.315;
      p.bev('matte', [1.14, 0.038, 0.309], 0.006, shade(RED, 0.92 + (i % 4) * 0.045), {
        pos: [0.6, 2.73, z], rot: [0, 0, -0.23],
      });
      p.box('matte', [1.14, 0.021, 0.012], shade(RED, 1.24), { pos: [0.604, 2.756, z + 0.15], rot: [0, 0, -0.23] });
    }
    p.box('matte', [0.06, 0.12, 3.78], RED, { pos: [1.145, 2.565, 0] });
    p.box('matte', [0.012, 0.018, 3.78], 0xc8bca0, { pos: [1.173, 2.524, 0] });

    // Large horizontal sign is physically bolted to a timber header above the awning.
    for (const z of [-1.55, 1.55]) timber([0.10, 0.73, 0.10], [0.54, 2.96, z]);
    timber([0.11, 0.62, 3.56], [0.61, 3.05, 0]);
    this.addPanel('supply-co-sign', 3.42, 0.51, [0.671, 3.05, 0], 1368, 204, '#e4d6b4', (g, w, h) => {
      g.fillStyle = '#e4d6b4'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#813f32'; g.fillRect(0, h - 28, w, 28);
      g.strokeStyle = '#ab9575'; g.lineWidth = 3; g.strokeRect(10, 9, w - 20, h - 45);
      g.fillStyle = '#372d25'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `900 100px ${FONT}`; g.fillText('SUPPLY CO.', w / 2, 68);
      g.font = `700 32px ${FONT}`; g.fillText('TOOLS · PARTS · MACHINERY', w / 2, 139);
      for (const x of [24, w - 24]) for (const y of [23, h - 50]) { g.fillStyle = '#6d614e'; g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); }
    });

    // A suspended enamel OPEN plaque under the roof, with short steel links.
    for (const z of [-0.255, 0.255]) p.rod('metal', [0.89, 2.56, z], [0.89, 2.35, z], 0.009, IRON, 5);
    p.bev('metal', [0.036, 0.28, 0.78], 0.015, CREAM, { pos: [0.88, 2.245, 0] });
    this.addPanel('supply-open', 0.73, 0.24, [0.901, 2.245, 0], 584, 192, '#e4d6b4', (g, w, h) => {
      g.fillStyle = '#e4d6b4'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#74392e'; g.lineWidth = 6; g.strokeRect(9, 9, w - 18, h - 18);
      g.fillStyle = '#74392e'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `900 130px ${FONT}`;
      g.fillText('OPEN', w / 2, h / 2 + 4);
    });

    this.addTools(p);

    // Freestanding chalkboard occupies the other half of the stall; clear of its sale counter.
    for (const z of [-1.63, -0.59]) {
      timber([0.08, 1.74, 0.065], [0.82, 0.89, z], [0, 0, -0.085]);
      timber([0.07, 1.63, 0.065], [0.46, 0.82, z], [0, 0, 0.20]);
      p.rod('metal', [0.29, 0.5, z], [0.85, 0.5, z], 0.011, IRON);
    }
    timber([0.095, 1.56, 1.16], [0.877, 0.99, -1.11], [0, 0, 0], 0x8c714f);
    p.box('matte', [0.02, 1.43, 1.025], 0x23302b, { pos: [0.932, 0.99, -1.11] });
    timber([0.17, 0.05, 1.17], [0.88, 0.243, -1.11], [0, 0, 0], 0x8c714f);
    p.box('matte', [0.022, 0.015, 0.1], 0xede7d6, { pos: [0.95, 0.278, -1.33] });
    this.board = this.addPanel('supply-prices', 1.005, 1.405, [0.944, 0.99, -1.11], 720, 1008, '#23302b', (g, w, h) => this.drawPrices(g, w, h, []));

    const built = p.build();
    if (built.main) {
      const mesh = new THREE.Mesh(built.main, modelMaterial());
      mesh.name = 'supply-timber-and-stock';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
      this.disposables.push(built.main);
    }
  }

  private addTools(p: Parts): void {
    // Open galvanised bucket: tapered outer and inner walls, rolled lip and arched wire handle.
    const x = 0.62, y = 1.066, z = 0.16;
    p.cyl('metal', 0.173, 0.127, 0.29, 0x9a9e8e, { pos: [x, y + 0.145, z] }, 14, 'y', true);
    const inner = new THREE.CylinderGeometry(0.162, 0.117, 0.278, 14, 1, true);
    flipFaces(inner);
    p.add('metal', inner, 0x525b52, { pos: [x, y + 0.15, z] });
    p.cyl('metal', 0.119, 0.119, 0.012, 0x525b52, { pos: [x, y + 0.013, z] }, 14);
    p.torus('metal', 0.169, 0.014, 0xb4b6a3, { pos: [x, y + 0.294, z], rot: [Math.PI / 2, 0, 0] }, 5, 16);
    p.tube('metal', [[x, y + 0.27, z - 0.17], [x, y + 0.50, z - 0.14], [x, y + 0.54, z], [x, y + 0.50, z + 0.14], [x, y + 0.27, z + 0.17]], 0.012, IRON, 5);

    // Shovel and pitchfork are displayed upright behind the counter, their heads fully visible.
    const shovelZ = 1.23;
    p.rod('matte', [0.45, 1.08, shovelZ], [0.39, 1.97, shovelZ + 0.07], 0.028, 0xa48250, 8);
    p.cyl('metal', 0.043, 0.033, 0.18, STEEL, { pos: [0.39, 1.99, shovelZ + 0.07] }, 8);
    p.add('metal', prism([[-0.15, 0.16], [0.15, 0.16], [0.145, -0.09], [0.08, -0.19], [0, -0.23], [-0.08, -0.19], [-0.145, -0.09]], 0.033), STEEL, { pos: [0.4, 2.20, shovelZ + 0.07], rot: [0, Math.PI / 2, Math.PI] });
    p.box('metal', [0.052, 0.20, 0.025], 0xb0b6a6, { pos: [0.422, 2.18, shovelZ + 0.07] });
    const forkZ = 0.73;
    p.rod('matte', [0.43, 1.065, forkZ + 0.035], [0.33, 1.99, forkZ], 0.026, 0x987c50, 8);
    p.box('metal', [0.038, 0.07, 0.34], STEEL, { pos: [0.335, 2.05, forkZ] });
    for (let i = 0; i < 4; i++) {
      const tz = forkZ - 0.135 + i * 0.09;
      p.rod('metal', [0.335, 2.07, tz], [0.36, 2.32, tz], 0.014, STEEL, 6);
      p.cyl('metal', 0.002, 0.014, 0.07, STEEL, { pos: [0.364, 2.35, tz] }, 6);
    }
    // A spanner and hardware crates on the rear shelf sell the small general-supply shop.
    p.rod('metal', [0.41, 1.59, -0.4], [0.38, 1.87, -0.4], 0.025, STEEL, 6);
    p.torus('metal', 0.065, 0.023, STEEL, { pos: [0.38, 1.91, -0.4], rot: [0, Math.PI / 2, 0.6] }, 5, 10, Math.PI * 1.5);
    for (const cz of [-0.84, -0.12]) {
      p.shell('matte', 0x886b46, 0.22, 0.39, 0.23, 0.41, 0.17, 0.022, { pos: [0.31, 1.588, cz] }, 0x40372a);
      p.box('matte', [0.009, 0.12, 0.032], 0x514130, { pos: [0.429, 1.665, cz - 0.13] });
      p.box('matte', [0.009, 0.12, 0.032], 0x514130, { pos: [0.429, 1.665, cz + 0.13] });
      for (let k = 0; k < 4; k++) p.torus('metal', 0.038, 0.011, IRON, { pos: [0.32, 1.79, cz - 0.13 + k * 0.08], rot: [0, Math.PI / 2, 0] }, 5, 8);
    }
  }

  private addPanel(name: string, width: number, height: number, pos: V3, pixelsX: number, pixelsY: number, fallback: string,
    paint: (g: CanvasRenderingContext2D, w: number, h: number) => void,
  ): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D; texture: THREE.CanvasTexture } | null {
    const canvas = typeof document === 'undefined' ? null : document.createElement('canvas');
    if (canvas) { canvas.width = pixelsX; canvas.height = pixelsY; }
    const context = canvas?.getContext('2d') ?? null;
    const texture = canvas && context ? new THREE.CanvasTexture(canvas) : null;
    if (texture && context) {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      paint(context, pixelsX, pixelsY);
      texture.needsUpdate = true;
      this.disposables.push(texture);
    }
    const geometry = new THREE.PlaneGeometry(width, height);
    const material = new THREE.MeshBasicMaterial(texture ? { map: texture, toneMapped: false } : { color: fallback });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.rotation.y = Math.PI / 2;
    mesh.position.set(...pos);
    this.root.add(mesh);
    this.disposables.push(geometry, material);
    return canvas && context && texture ? { canvas, context, texture } : null;
  }

  private drawPrices(g: CanvasRenderingContext2D, w: number, h: number, rows: readonly SupplyPriceRow[]): void {
    g.fillStyle = '#23302b'; g.fillRect(0, 0, w, h);
    // Low-contrast chalk smears keep the large letters and prices crisp at gameplay distance.
    for (let i = 0; i < 60; i++) {
      g.fillStyle = i % 3 ? 'rgba(239,232,209,0.023)' : 'rgba(0,0,0,0.04)';
      g.fillRect(22 + (i * 137) % (w - 100), 16 + (i * 79) % (h - 40), 55 + i % 60, 2);
    }
    g.strokeStyle = '#c9c7ad'; g.lineWidth = 2; g.strokeRect(20, 18, w - 40, h - 36);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#eee7cf';
    g.font = `700 79px ${FONT}`; g.fillText('PRICES', w / 2, 78);
    g.beginPath(); g.moveTo(70, 129); g.lineTo(w - 70, 131); g.stroke();
    g.font = `700 43px ${FONT}`; g.fillStyle = '#d6bf83'; g.fillText('TOOLS', w / 2, 176);
    const tools = rows.filter(row => row.id !== 'wheelbarrow');
    for (let i = 0; i < tools.length; i++) {
      const row = tools[i], y = 247 + i * 110;
      g.fillStyle = '#f0ead4'; g.textAlign = 'left'; g.font = `700 32px ${FONT}`;
      g.fillText(row.label, 48, y, 438);
      g.textAlign = 'right'; g.font = `700 37px ${FONT}`; g.fillText(row.price, w - 48, y);
      g.textAlign = 'left'; g.font = `700 23px ${FONT}`;
      g.fillStyle = row.state === 'OWNED' ? '#accca4' : row.state === 'LOCKED' ? '#d1bd8f' : '#abbdb0';
      g.fillText(row.state === 'AVAILABLE' ? 'PLAN UNLOCKED' : row.state, 48, y + 36);
    }
    const wheelbarrow = rows.find(row => row.id === 'wheelbarrow');
    g.strokeStyle = '#b5b7a0'; g.beginPath(); g.moveTo(48, 766); g.lineTo(w - 48, 766); g.stroke();
    g.fillStyle = '#d6bf83'; g.textAlign = 'center'; g.font = `700 40px ${FONT}`; g.fillText('WHEELBARROW', w / 2, 815);
    if (wheelbarrow) {
      g.fillStyle = '#f0ead4'; g.font = `700 51px ${FONT}`; g.fillText(wheelbarrow.price, w / 2, 876);
      g.fillStyle = wheelbarrow.state === 'OWNED' ? '#accca4' : '#d1bd8f'; g.font = `700 24px ${FONT}`;
      g.fillText(wheelbarrow.state === 'AVAILABLE' ? 'PLAN UNLOCKED' : wheelbarrow.state, w / 2, 924);
    }
    g.fillStyle = '#b6bba7'; g.font = `700 19px ${FONT}`; g.fillText('PLANS AT THE WORK TREE', w / 2, 970);
  }

  update(sim: Sim): void {
    if (!this.board) return;
    // Only plan/ownership changes redraw the canvas and upload its texture.
    const p = sim.progress;
    let signature = p.hasWheelbarrow ? '1' : '0';
    for (const id of TOOL_IDS) {
      const req = TOOLS[id].requiresNode;
      signature += `${p.ownedTools.has(id) ? 1 : 0}${req && p.isUnlocked(req) ? 1 : 0}`;
    }
    signature += p.isUnlocked(WHEELBARROW.requiresNode) ? '1' : '0';
    if (signature === this.priceSignature) return;
    this.priceSignature = signature;
    const { canvas, context, texture } = this.board;
    this.drawPrices(context, canvas.width, canvas.height, supplyPriceRows(p));
    texture.needsUpdate = true;
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
    this.root.removeFromParent();
  }
}
