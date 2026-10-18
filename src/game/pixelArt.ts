import type { Appearance } from '../types';
import { MAP_H, MAP_W, TILE, idx, type Floor, type FurnitureKind, type OfficeMap } from '../sim/map';
import { hash } from '../sim/random';

/**
 * All art is painted procedurally into canvases at 1 px = 1 game pixel, then
 * scaled by the camera with nearest-neighbour filtering. No image files.
 */

export const OL = '#2b2230'; // outline ink
const C = {
  wood: '#dcc6a6',
  woodLine: '#c6ab86',
  woodSeam: '#b89a74',
  diag: '#d9b089',
  diagLine: '#c7996f',
  carpet: '#8d85c6',
  carpetA: '#8279ba',
  carpetB: '#9a92d1',
  stone: '#e4ded3',
  grout: '#cbc3b4',
  corridor: '#d2ccc0',
  corridorLine: '#c6bfb2',
  wall: '#d9d3c7',
  wallFace: '#f3f0ea',
  wallFaceShade: '#e4dfd6',
  baseboard: '#6b5f55',
  void: '#a8a196',
  navy: '#3d4766',
  navyLight: '#56618a',
  navyDark: '#2a3149',
  crimson: '#8c2f3b',
  crimsonLight: '#a8414d',
  leaf: '#4f8a3a',
  leafLight: '#79b24f',
  leafDark: '#33612a',
  pot: '#8a5a3c',
  potLight: '#a8714c',
  paper: '#f4f1e8',
  metal: '#b9c0c9',
  metalLight: '#d7dce2',
  metalDark: '#7d8794',
};

export type Ctx = CanvasRenderingContext2D;

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

const r = (ctx: Ctx, color: string, x: number, y: number, w = 1, h = 1) => {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
};

/** Filled rectangle with a 1px ink outline. */
const box = (ctx: Ctx, fill: string, x: number, y: number, w: number, h: number) => {
  r(ctx, OL, x, y, w, h);
  r(ctx, fill, x + 1, y + 1, w - 2, h - 2);
};

export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
  const rr = f(n >> 16);
  const gg = f((n >> 8) & 255);
  const bb = f(n & 255);
  return `#${((rr << 16) | (gg << 8) | bb).toString(16).padStart(6, '0')}`;
}

// =========================================================================== floors
function paintFloorTile(ctx: Ctx, f: Floor, tx: number, ty: number) {
  const x = tx * TILE;
  const y = ty * TILE;
  const h = hash(`${tx},${ty}`);
  switch (f) {
    case 'wood': {
      r(ctx, C.wood, x, y, TILE, TILE);
      // planks: 4 px tall rows with staggered seams, like the reference floor
      for (let row = 0; row < 4; row++) {
        const py = y + row * 4;
        r(ctx, C.woodLine, x, py + 3, TILE, 1);
        const seam = (hash(`${tx >> 1},${ty * 4 + row}`) % 24) - 4;
        const sx = ((tx * 16 + seam) % 32) - (tx % 2) * 16;
        if (sx >= 0 && sx < 16) r(ctx, C.woodSeam, x + sx, py, 1, 3);
        if (hash(`${tx},${ty},${row}`) % 7 === 0) r(ctx, shade(C.wood, 0.03), x + ((h >> row) % 12), py + 1, 3, 1);
      }
      break;
    }
    case 'woodDiag': {
      r(ctx, C.diag, x, y, TILE, TILE);
      for (let i = 0; i < TILE; i++) for (let j = 0; j < TILE; j++) if ((x + i + y + j) % 8 === 0) r(ctx, C.diagLine, x + i, y + j);
      for (let i = 0; i < TILE; i++) for (let j = 0; j < TILE; j++) if ((x + i - (y + j) + 1024) % 32 === 0) r(ctx, shade(C.diag, -0.05), x + i, y + j);
      break;
    }
    case 'carpet': {
      r(ctx, C.carpet, x, y, TILE, TILE);
      for (let k = 0; k < 10; k++) {
        const v = hash(`${tx},${ty},${k}`);
        r(ctx, v % 2 ? C.carpetA : C.carpetB, x + (v % 16), y + ((v >> 5) % 16));
      }
      break;
    }
    case 'stone': {
      r(ctx, C.grout, x, y, TILE, TILE);
      for (let row = 0; row < 2; row++) {
        const off = (ty * 2 + row) % 2 ? 8 : 0;
        for (let col = -1; col < 2; col++) {
          const bx = x + col * 16 + off;
          const sx = Math.max(bx + 1, x);
          const ex = Math.min(bx + 16, x + 16);
          if (ex > sx) r(ctx, (hash(`${tx},${ty},${row},${col}`) % 5 === 0) ? shade(C.stone, -0.02) : C.stone, sx, y + row * 8 + 1, ex - sx, 7);
        }
      }
      break;
    }
    case 'corridor':
      r(ctx, C.corridor, x, y, TILE, TILE);
      if (h % 9 === 0) r(ctx, C.corridorLine, x + (h % 13), y + ((h >> 4) % 13), 2, 1);
      break;
    case 'wall':
      r(ctx, C.wall, x, y, TILE, TILE);
      break;
    case 'wallFace':
      r(ctx, C.wallFace, x, y, TILE, TILE);
      break;
    default:
      r(ctx, C.void, x, y, TILE, TILE);
  }
}

export function paintMap(map: OfficeMap): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(MAP_W * TILE, MAP_H * TILE);
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) paintFloorTile(ctx, map.floor[idx(x, y)], x, y);

  const at = (x: number, y: number): Floor => (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H ? 'void' : map.floor[idx(x, y)]);
  const solid = (f: Floor) => f === 'wall' || f === 'void';
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const f = at(x, y);
      const px = x * TILE;
      const py = y * TILE;
      if (f === 'wallFace') {
        // wall band: subtle top shading, and baseboard + floor shadow at the bottom
        if (at(x, y - 1) !== 'wallFace') r(ctx, C.wallFaceShade, px, py, TILE, 2);
        if (at(x, y + 1) !== 'wallFace') {
          r(ctx, C.wallFaceShade, px, py + 12, TILE, 2);
          r(ctx, C.baseboard, px, py + 14, TILE, 2);
          r(ctx, 'rgba(60,40,30,0.18)', px, py + 16, TILE, 3);
        }
      }
      if (solid(f)) {
        // dark outline where wall meets an interior surface
        if (!solid(at(x + 1, y))) r(ctx, OL, px + 14, py, 2, TILE);
        if (!solid(at(x - 1, y))) r(ctx, OL, px, py, 2, TILE);
        if (!solid(at(x, y + 1))) r(ctx, OL, px, py + 14, TILE, 2);
        if (!solid(at(x, y - 1))) r(ctx, OL, px, py, TILE, 2);
      } else if (f !== 'wallFace' && f !== 'corridor') {
        // soft shadow cast by side walls onto the floor
        if (solid(at(x - 1, y))) r(ctx, 'rgba(60,40,30,0.10)', px, py, 3, TILE);
      }
    }
  }
  return c;
}

// =========================================================================== furniture
export interface FurnitureArt {
  canvas: HTMLCanvasElement;
  /** Pixel offset of the canvas' left edge from the footprint's left edge. */
  offsetX: number;
}

function plant(ctx: Ctx, ox: number, big: boolean) {
  const w = big ? 24 : 16;
  const h = big ? 32 : 24;
  const potW = big ? 10 : 8;
  const px = ox + (w - potW) / 2;
  box(ctx, C.pot, px, h - 9, potW, 9);
  r(ctx, C.potLight, px + 1, h - 8, potW - 2, 2);
  r(ctx, '#4a3326', px + 1, h - 9, potW - 2, 1);
  // leaves: a fan of blades with highlights
  const leaves = big
    ? [[11, 2], [6, 5], [16, 5], [3, 10], [19, 10], [8, 9], [14, 9], [11, 7], [5, 15], [17, 15]]
    : [[7, 3], [4, 6], [10, 6], [3, 11], [11, 11], [7, 8], [5, 13], [9, 13]];
  for (const [lx, ly] of leaves) {
    r(ctx, OL, ox + lx - 1, ly - 1, 5, 5);
  }
  for (const [lx, ly] of leaves) {
    r(ctx, C.leafDark, ox + lx, ly, 3, 3);
    r(ctx, C.leaf, ox + lx, ly, 3, 2);
    r(ctx, C.leafLight, ox + lx + 1, ly, 1, 1);
  }
}

function drawFurniture(kind: FurnitureKind, w: number, h: number): FurnitureArt {
  const W = w * TILE;
  const H = h * TILE;
  let canvas: HTMLCanvasElement;
  let ctx: Ctx;
  let offsetX = 0;
  const make = (cw: number, ch: number) => ([canvas, ctx] = makeCanvas(cw, ch));

  switch (kind) {
    case 'desk': {
      make(W, H + 8);
      // surface
      box(ctx!, C.navyLight, 0, 8, W, 22);
      r(ctx!, shade(C.navyLight, 0.06), 1, 9, W - 2, 2);
      // front panel
      box(ctx!, C.navy, 0, 28, W, H + 8 - 28);
      r(ctx!, C.navyDark, 1, H + 8 - 3, W - 2, 2);
      r(ctx!, OL, 6, 31, 1, 6);
      r(ctx!, OL, W - 7, 31, 1, 6);
      // monitor beside the seat so the worker stays visible (as in the reference)
      box(ctx!, C.metal, 31, 0, 19, 15);
      r(ctx!, C.metalLight, 32, 1, 17, 3);
      r(ctx!, C.metalDark, 32, 12, 17, 2);
      r(ctx!, OL, 39, 15, 4, 3);
      r(ctx!, C.metalDark, 35, 17, 11, 2);
      // keyboard in front of the worker, papers, mug
      box(ctx!, C.metalLight, 16, 20, 15, 4);
      r(ctx!, C.metal, 17, 21, 13, 1);
      r(ctx!, C.metalLight, 33, 21, 3, 2);
      box(ctx!, C.paper, 3, 12, 10, 11);
      r(ctx!, '#c9c2b2', 5, 15, 6, 1);
      r(ctx!, '#c9c2b2', 5, 18, 5, 1);
      box(ctx!, C.crimsonLight, 54, 14, 5, 6);
      r(ctx!, C.paper, 52, 23, 8, 3);
      break;
    }
    case 'chair':
      make(W, H);
      box(ctx!, C.crimson, 3, 0, 10, 9);
      r(ctx!, C.crimsonLight, 4, 1, 8, 2);
      box(ctx!, C.crimson, 2, 7, 12, 7);
      r(ctx!, OL, 7, 14, 2, 2);
      break;
    case 'plant':
      make(W, 24);
      plant(ctx!, 0, false);
      break;
    case 'bigPlant':
      make(24, 32);
      offsetX = -4;
      plant(ctx!, 0, true);
      break;
    case 'bookshelf': {
      const ch = H + (h < 3 ? 8 : 0);
      make(W, ch);
      box(ctx!, '#9a6a44', 0, 0, W, ch);
      r(ctx!, '#b07d52', 1, 1, W - 2, 1);
      const books = ['#c4473a', '#3d6aa8', '#4f8a4b', '#d9b84a', '#7b4f9c', '#e8eef2'];
      for (let shelf = 0; shelf * 9 + 10 < ch; shelf++) {
        const sy = 3 + shelf * 9;
        r(ctx!, '#6e4a2f', 1, sy + 7, W - 2, 1);
        for (let b = 0; b < 4; b++) r(ctx!, books[(shelf * 3 + b) % books.length], 2 + b * 3, sy + (b % 2), 2, 7 - (b % 2));
      }
      break;
    }
    case 'cabinet':
      make(W, H + 8);
      box(ctx!, C.navyDark, 0, 0, W, H + 8);
      r(ctx!, C.navy, 1, 1, W - 2, 2);
      for (let i = 0; i < 3; i++) {
        r(ctx!, OL, 1, 10 + i * 9, W - 2, 1);
        r(ctx!, C.metal, 6, 6 + i * 9, 4, 1);
      }
      break;
    case 'wallCabinet':
      make(W, H);
      box(ctx!, C.navy, 2, 6, W - 4, H - 6);
      for (let i = 0; i < 4; i++) {
        r(ctx!, OL, 3, 16 + i * 8, W - 6, 1);
        r(ctx!, C.metal, W / 2 - 3, 12 + i * 8, 6, 1);
      }
      r(ctx!, C.navyLight, 3, 7, W - 6, 2);
      break;
    case 'copier':
      make(W, H + 12);
      box(ctx!, C.metal, 2, 6, W - 4, H + 6);
      r(ctx!, C.metalLight, 3, 7, W - 6, 6);
      box(ctx!, C.metalDark, 6, 0, 18, 10);
      r(ctx!, '#3d6aa8', 30, 9, 8, 3);
      for (let i = 0; i < 3; i++) {
        r(ctx!, OL, 3, 20 + i * 7, W - 6, 1);
        r(ctx!, C.metalDark, 10, 23 + i * 7, 8, 1);
      }
      break;
    case 'bin':
      make(W, H);
      box(ctx!, '#6f8fb3', 3, 5, 10, 11);
      r(ctx!, '#8eaccc', 4, 6, 8, 2);
      r(ctx!, C.paper, 5, 3, 3, 3);
      r(ctx!, C.paper, 8, 2, 3, 4);
      break;
    case 'clock':
      make(W, H);
      r(ctx!, OL, 3, 1, 10, 14);
      r(ctx!, OL, 1, 3, 14, 10);
      r(ctx!, '#55607a', 2, 4, 12, 8);
      r(ctx!, '#55607a', 4, 2, 8, 12);
      r(ctx!, C.paper, 4, 4, 8, 8);
      r(ctx!, OL, 7, 5, 1, 4);
      r(ctx!, OL, 8, 8, 3, 1);
      break;
    case 'poster':
      make(W, H);
      box(ctx!, C.paper, 1, 3, 14, 24);
      r(ctx!, '#d9b84a', 3, 6, 10, 6);
      r(ctx!, '#c9c2b2', 3, 15, 10, 1);
      r(ctx!, '#c9c2b2', 3, 18, 8, 1);
      r(ctx!, '#c9c2b2', 3, 21, 9, 1);
      break;
    case 'chart':
      make(W, H);
      box(ctx!, C.paper, 1, 3, 14, 20);
      r(ctx!, '#c4473a', 4, 13, 2, 7);
      r(ctx!, '#3d6aa8', 7, 9, 2, 11);
      r(ctx!, '#4f8a4b', 10, 15, 2, 5);
      break;
    case 'radio':
      make(W, H);
      box(ctx!, '#2f2f38', 0, 4, 16, 10);
      r(ctx!, '#d9d3c7', 2, 6, 5, 6);
      r(ctx!, '#d9d3c7', 9, 6, 5, 6);
      r(ctx!, OL, 3, 8, 3, 2);
      r(ctx!, OL, 10, 8, 3, 2);
      break;
    case 'meetingTable':
      make(W, H + 4);
      r(ctx!, OL, 6, 4, W - 12, H - 10);
      r(ctx!, OL, 2, 8, W - 4, H - 18);
      r(ctx!, '#2f3446', 7, 5, W - 14, H - 12);
      r(ctx!, '#2f3446', 3, 9, W - 6, H - 20);
      r(ctx!, '#424a63', 9, 7, W - 22, 3);
      r(ctx!, OL, W / 2 - 2, H - 6, 4, 8);
      r(ctx!, OL, W / 2 - 8, H + 1, 16, 2);
      break;
    case 'blueChair':
      make(W, H);
      box(ctx!, '#3355a8', 3, 2, 10, 12);
      r(ctx!, '#4b6fc4', 4, 3, 8, 3);
      r(ctx!, OL, 7, 14, 2, 2);
      break;
    case 'sofaDown':
      make(W, H + 12);
      box(ctx!, '#2c3d78', 0, 0, W, 16); // back
      r(ctx!, '#3b4f92', 1, 1, W - 2, 3);
      box(ctx!, '#344892', 0, 12, W, 16); // seat
      for (let i = 1; i < w; i++) r(ctx!, '#2a3a74', i * 16, 13, 1, 12);
      box(ctx!, '#2c3d78', 0, 8, 5, 20);
      box(ctx!, '#2c3d78', W - 5, 8, 5, 20);
      break;
    case 'sofaUp':
      make(W, H + 8);
      box(ctx!, '#344892', 0, 0, W, 14); // seat
      for (let i = 1; i < w; i++) r(ctx!, '#2a3a74', i * 16, 1, 1, 12);
      box(ctx!, '#2c3d78', 0, 10, W, 14); // back, in front
      r(ctx!, '#3b4f92', 1, 11, W - 2, 3);
      box(ctx!, '#2c3d78', 0, 0, 5, 22);
      box(ctx!, '#2c3d78', W - 5, 0, 5, 22);
      break;
    case 'coffeeTable':
      make(W, H);
      box(ctx!, '#4a4f5c', 2, 3, W - 4, 8);
      r(ctx!, '#606778', 3, 4, W - 6, 2);
      r(ctx!, OL, 5, 11, 2, 4);
      r(ctx!, OL, W - 7, 11, 2, 4);
      break;
    case 'beanbag':
      make(W, H);
      r(ctx!, OL, 2, 4, 12, 12);
      r(ctx!, OL, 1, 7, 14, 8);
      r(ctx!, '#c9734a', 3, 5, 10, 10);
      r(ctx!, '#c9734a', 2, 8, 12, 6);
      r(ctx!, '#df8b60', 4, 6, 5, 3);
      break;
    case 'armchair':
      make(W, H + 8);
      box(ctx!, '#2c3d78', 1, 0, 14, 14);
      r(ctx!, '#3b4f92', 2, 1, 12, 3);
      box(ctx!, '#344892', 1, 10, 14, 14);
      box(ctx!, '#2c3d78', 0, 8, 4, 16);
      box(ctx!, '#2c3d78', 12, 8, 4, 16);
      break;
    case 'vending':
      make(W, H);
      box(ctx!, '#7a2235', 1, 0, W - 2, H);
      box(ctx!, '#2f3446', 4, 4, 16, 30);
      const cans = ['#d9b84a', '#4f8a4b', '#c4473a', '#3d6aa8'];
      for (let row = 0; row < 4; row++) for (let col = 0; col < 3; col++) r(ctx!, cans[(row + col) % 4], 6 + col * 5, 6 + row * 7, 3, 4);
      r(ctx!, C.metal, 23, 8, 5, 10);
      r(ctx!, OL, 6, 38, 14, 4);
      break;
    case 'cooler':
      make(W, H);
      box(ctx!, '#7fb0e0', 3, 0, 10, 11);
      r(ctx!, '#a8cdef', 4, 1, 3, 8);
      box(ctx!, '#e8eef2', 2, 10, 12, H - 10);
      r(ctx!, '#3d6aa8', 6, 14, 4, 2);
      break;
    case 'boxes':
      make(W, H);
      box(ctx!, '#c9a46c', 1, 4, 14, 12);
      r(ctx!, '#b08b55', 2, 9, 12, 1);
      r(ctx!, '#e0bf8a', 2, 5, 12, 2);
      break;
    case 'smallTable':
      make(W, H + 4);
      box(ctx!, C.navyLight, 1, 0, W - 2, 12);
      r(ctx!, shade(C.navyLight, 0.06), 2, 1, W - 4, 2);
      box(ctx!, C.navy, 1, 11, W - 2, 9);
      break;
    case 'lamp':
      make(W, 24);
      r(ctx!, OL, 4, 0, 8, 6);
      r(ctx!, '#e8d9a0', 5, 1, 6, 4);
      r(ctx!, OL, 7, 6, 2, 14);
      r(ctx!, OL, 4, 20, 8, 3);
      break;
    case 'stool':
      make(W, H);
      r(ctx!, OL, 3, 4, 10, 8);
      r(ctx!, C.navyDark, 4, 5, 8, 6);
      r(ctx!, C.navy, 5, 5, 6, 2);
      r(ctx!, OL, 5, 12, 1, 3);
      r(ctx!, OL, 10, 12, 1, 3);
      break;
  }
  return { canvas: canvas!, offsetX };
}

export function furnitureArt(kind: FurnitureKind, w: number, h: number) {
  return drawFurniture(kind, w, h);
}

export function cushionArt(): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(16, 16);
  r(ctx, OL, 1, 5, 14, 10);
  r(ctx, '#b7a679', 2, 6, 12, 8);
  r(ctx, '#cbbb8d', 3, 7, 6, 2);
  return c;
}

// =========================================================================== characters
export const CHAR_W = 16;
export const CHAR_H = 24;
export const FRAMES = {
  down: [0, 1, 2],
  up: [3, 4, 5],
  side: [6, 7, 8],
  type: [9, 10],
  sleepSit: 11,
  sit: 12,
  sitBack: 13,
} as const;
export const FRAME_COUNT = 14;

type View = 'down' | 'up' | 'side';

function drawHair(ctx: Ctx, ox: number, oy: number, a: Appearance, view: View) {
  const hc = a.hair;
  const hl = shade(hc, 0.12);
  const s = a.hairStyle;
  if (view === 'down') {
    if (s === 'bald') {
      r(ctx, a.skin, ox + 4, oy + 2, 8, 3);
      r(ctx, hc, ox + 4, oy + 5, 1, 2);
      r(ctx, hc, ox + 11, oy + 5, 1, 2);
      r(ctx, shade(a.skin, 0.1), ox + 6, oy + 2, 2, 1);
      return;
    }
    r(ctx, hc, ox + 4, oy + 2, 8, 3);
    r(ctx, hc, ox + 4, oy + 5, 2, 1);
    r(ctx, hc, ox + 10, oy + 5, 2, 1);
    r(ctx, hc, ox + 4, oy + 5, 1, s === 'long' ? 7 : 2);
    r(ctx, hc, ox + 11, oy + 5, 1, s === 'long' ? 7 : 2);
    r(ctx, hl, ox + 6, oy + 2, 3, 1);
    if (s === 'spiky') {
      for (const sx of [5, 7, 9]) {
        r(ctx, OL, ox + sx, oy, 1, 1);
        r(ctx, hc, ox + sx, oy + 1, 1, 1);
      }
    }
    if (s === 'bun') {
      r(ctx, OL, ox + 6, oy - 1, 4, 1);
      r(ctx, hc, ox + 6, oy, 4, 2);
    }
    if (s === 'curly') {
      r(ctx, hc, ox + 4, oy + 5, 8, 1);
      r(ctx, hl, ox + 5, oy + 3, 1, 1);
      r(ctx, hl, ox + 9, oy + 3, 1, 1);
    }
  } else if (view === 'up') {
    if (s === 'bald') {
      r(ctx, a.skin, ox + 4, oy + 2, 8, 9);
      r(ctx, hc, ox + 4, oy + 7, 8, 3);
      return;
    }
    r(ctx, hc, ox + 4, oy + 2, 8, s === 'long' ? 10 : 8);
    r(ctx, hl, ox + 6, oy + 3, 3, 1);
    if (s === 'bun') {
      r(ctx, OL, ox + 6, oy - 1, 4, 1);
      r(ctx, hc, ox + 6, oy, 4, 2);
      r(ctx, shade(hc, -0.08), ox + 6, oy + 4, 4, 2);
    }
    if (s === 'spiky') for (const sx of [5, 7, 9]) r(ctx, OL, ox + sx, oy, 1, 1);
  } else {
    if (s === 'bald') {
      r(ctx, a.skin, ox + 5, oy + 2, 7, 3);
      r(ctx, hc, ox + 5, oy + 5, 3, 3);
      return;
    }
    r(ctx, hc, ox + 5, oy + 2, 7, 3);
    r(ctx, hc, ox + 5, oy + 5, 3, s === 'long' ? 7 : 3);
    r(ctx, hl, ox + 7, oy + 2, 3, 1);
    if (s === 'bun') {
      r(ctx, OL, ox + 3, oy + 2, 2, 4);
      r(ctx, hc, ox + 3, oy + 3, 2, 2);
    }
    if (s === 'spiky') for (const sx of [6, 8, 10]) r(ctx, OL, ox + sx, oy + 1, 1, 1);
  }
}

interface CharOpts {
  view: View;
  step: -1 | 0 | 1;
  legs: boolean;
  eyesClosed?: boolean;
  typing?: 0 | 1;
}

function drawCharacter(ctx: Ctx, ox: number, a: Appearance, o: CharOpts) {
  const bob = o.step !== 0 ? -1 : 0;
  const oy = 1 + bob + (o.eyesClosed ? 1 : 0);
  const shirtDark = shade(a.shirt, -0.14);
  const pantsDark = shade(a.pants, -0.1);

  if (o.view === 'side') {
    // ---- side view (facing right) ----
    if (o.legs) {
      r(ctx, OL, ox + 5, oy + 17, 7, 6);
      const back = o.step === 1 ? 1 : 0;
      const front = o.step === -1 ? 1 : 0;
      r(ctx, pantsDark, ox + 6, oy + 17, 2, 4 - back);
      r(ctx, '#3a2a22', ox + 6, oy + 21 - back, 2, 1);
      r(ctx, a.pants, ox + 9, oy + 17, 2, 4 - front);
      r(ctx, '#3a2a22', ox + 9, oy + 21 - front, 3, 1);
    }
    r(ctx, OL, ox + 5, oy + 10, 7, 8);
    r(ctx, a.shirt, ox + 6, oy + 11, 5, 6);
    r(ctx, shirtDark, ox + 8, oy + 12, 2, 4);
    r(ctx, a.skin, ox + 8, oy + 16, 2, 1);
    r(ctx, OL, ox + 4, oy, 9, 11);
    r(ctx, a.skin, ox + 5, oy + 3, 7, 7);
    r(ctx, a.skin, ox + 12, oy + 6, 1, 2);
    drawHair(ctx, ox, oy, a, 'side');
    r(ctx, OL, ox + 10, oy + 6, 1, 2);
    return;
  }

  // ---- front / back view ----
  if (o.legs) {
    r(ctx, OL, ox + 4, oy + 17, 8, 6);
    const lUp = o.step === 1 ? 1 : 0;
    const rUp = o.step === -1 ? 1 : 0;
    r(ctx, a.pants, ox + 5, oy + 17, 3, 4 - lUp);
    r(ctx, '#3a2a22', ox + 5, oy + 21 - lUp, 3, 1);
    r(ctx, pantsDark, ox + 8, oy + 17, 3, 4 - rUp);
    r(ctx, '#3a2a22', ox + 8, oy + 21 - rUp, 3, 1);
    r(ctx, OL, ox + 7, oy + 18, 1, 3);
  }
  // torso
  r(ctx, OL, ox + 3, oy + 10, 10, 8);
  r(ctx, a.shirt, ox + 4, oy + 11, 8, 6);
  r(ctx, shirtDark, ox + 4, oy + 11, 1, 5);
  r(ctx, shirtDark, ox + 11, oy + 11, 1, 5);
  if (o.view === 'down') r(ctx, a.skin, ox + 7, oy + 11, 2, 1);
  r(ctx, pantsDark, ox + 4, oy + 16, 8, 1);
  // hands
  if (o.typing !== undefined) {
    const t = o.typing;
    r(ctx, a.skin, ox + 5, oy + 15 - t, 2, 1);
    r(ctx, a.skin, ox + 9, oy + 14 + t, 2, 1);
  } else {
    r(ctx, a.skin, ox + 4, oy + 16, 1, 1);
    r(ctx, a.skin, ox + 11, oy + 16, 1, 1);
  }
  // head
  r(ctx, OL, ox + 3, oy, 10, 11);
  r(ctx, a.skin, ox + 4, oy + 3, 8, 7);
  drawHair(ctx, ox, oy, a, o.view);
  if (o.view === 'down') {
    if (o.eyesClosed) {
      r(ctx, OL, ox + 5, oy + 7, 2, 1);
      r(ctx, OL, ox + 9, oy + 7, 2, 1);
    } else {
      r(ctx, OL, ox + 6, oy + 6, 1, 2);
      r(ctx, OL, ox + 9, oy + 6, 1, 2);
    }
    r(ctx, shade(a.skin, -0.08), ox + 7, oy + 9, 2, 1);
  }
}

/** One horizontal strip of FRAME_COUNT frames for a given look. */
export function characterSheet(a: Appearance): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(CHAR_W * FRAME_COUNT, CHAR_H);
  const f = (i: number, o: CharOpts) => drawCharacter(ctx, i * CHAR_W, a, o);
  f(0, { view: 'down', step: 0, legs: true });
  f(1, { view: 'down', step: 1, legs: true });
  f(2, { view: 'down', step: -1, legs: true });
  f(3, { view: 'up', step: 0, legs: true });
  f(4, { view: 'up', step: 1, legs: true });
  f(5, { view: 'up', step: -1, legs: true });
  f(6, { view: 'side', step: 0, legs: true });
  f(7, { view: 'side', step: 1, legs: true });
  f(8, { view: 'side', step: -1, legs: true });
  f(9, { view: 'down', step: 0, legs: false, typing: 0 });
  f(10, { view: 'down', step: 0, legs: false, typing: 1 });
  f(11, { view: 'down', step: 0, legs: false, eyesClosed: true });
  f(12, { view: 'down', step: 0, legs: false });
  f(13, { view: 'up', step: 0, legs: false });
  return c;
}

// =========================================================================== status icons
export type IconKind = 'THINKING' | 'WAITING' | 'COMPLETED' | 'ERROR' | 'Z';

export function iconArt(kind: IconKind): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(11, 11);
  if (kind === 'Z') {
    r(ctx, OL, 2, 2, 7, 7);
    r(ctx, '#f3f0ea', 3, 3, 5, 1);
    r(ctx, '#f3f0ea', 6, 4, 1, 1);
    r(ctx, '#f3f0ea', 5, 5, 1, 1);
    r(ctx, '#f3f0ea', 4, 6, 1, 1);
    r(ctx, '#f3f0ea', 3, 7, 5, 1);
    return c;
  }
  const bg = { THINKING: '#7b4f9c', WAITING: '#c98a1e', COMPLETED: '#3f8a46', ERROR: '#c43b34' }[kind];
  r(ctx, OL, 1, 0, 9, 11);
  r(ctx, OL, 0, 1, 11, 9);
  r(ctx, bg, 1, 1, 9, 9);
  const w = '#ffffff';
  if (kind === 'THINKING') {
    r(ctx, w, 2, 5, 1, 1);
    r(ctx, w, 5, 5, 1, 1);
    r(ctx, w, 8, 5, 1, 1);
  } else if (kind === 'WAITING') {
    r(ctx, w, 3, 2, 5, 1);
    r(ctx, w, 4, 3, 3, 1);
    r(ctx, w, 5, 4, 1, 2);
    r(ctx, w, 4, 6, 3, 1);
    r(ctx, w, 3, 8, 5, 1);
  } else if (kind === 'COMPLETED') {
    r(ctx, w, 2, 5, 1, 1);
    r(ctx, w, 3, 6, 1, 1);
    r(ctx, w, 4, 7, 1, 1);
    r(ctx, w, 5, 6, 1, 1);
    r(ctx, w, 6, 5, 1, 1);
    r(ctx, w, 7, 4, 1, 1);
    r(ctx, w, 8, 3, 1, 1);
  } else {
    r(ctx, w, 5, 2, 1, 5);
    r(ctx, w, 5, 8, 1, 1);
  }
  return c;
}
