import type { Facing, Point } from '../types';

/**
 * Office layout, modelled on the reference image:
 *   Room A (left)   – large wood-floor workspace, 3 rows of desks + manager desk
 *   Room B (middle) – meeting table (diagonal wood) above a purple-carpet lounge
 *   Room C (right)  – tiled break room with vending machine and a few desks
 * Rooms are separated by narrow corridors and joined by doorways.
 */
export const TILE = 16;
export const MAP_W = 51;
export const MAP_H = 37;

export type Floor = 'void' | 'wall' | 'wallFace' | 'wood' | 'woodDiag' | 'carpet' | 'stone' | 'corridor';

export type FurnitureKind =
  | 'desk'
  | 'chair'
  | 'plant'
  | 'bigPlant'
  | 'bookshelf'
  | 'cabinet'
  | 'wallCabinet'
  | 'copier'
  | 'bin'
  | 'clock'
  | 'poster'
  | 'chart'
  | 'radio'
  | 'meetingTable'
  | 'blueChair'
  | 'sofaDown'
  | 'sofaUp'
  | 'coffeeTable'
  | 'beanbag'
  | 'armchair'
  | 'vending'
  | 'cooler'
  | 'boxes'
  | 'smallTable'
  | 'lamp'
  | 'stool';

export interface Furniture {
  id: string;
  kind: FurnitureKind;
  /** Footprint in tiles. */
  x: number;
  y: number;
  w: number;
  h: number;
  blocks: boolean;
  /** Decorations mounted on the wall band – drawn behind everything. */
  onWall?: boolean;
}

export interface Workstation {
  id: string;
  label: string;
  room: RoomId;
  seat: Point;
  deskFurnitureId: string;
}

export interface RestSpot {
  id: string;
  room: RoomId;
  pos: Point;
  kind: 'sofa' | 'beanbag' | 'armchair' | 'floor';
  facing: Facing;
}

export type RoomId = 'workspace' | 'meeting' | 'lounge' | 'breakroom' | 'corridor';

export interface Room {
  id: RoomId;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OfficeMap {
  width: number;
  height: number;
  floor: Floor[];
  /** 1 = blocked for walking. Seats are blocked but may be a path start/goal. */
  blocked: Uint8Array;
  seats: Set<number>;
  furniture: Furniture[];
  workstations: Workstation[];
  restSpots: RestSpot[];
  rooms: Room[];
  walkable: Point[];
}

export const idx = (x: number, y: number) => y * MAP_W + x;
export const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

export const ROOMS: Room[] = [
  { id: 'workspace', name: 'Workspace', x: 1, y: 4, w: 21, h: 32 },
  { id: 'meeting', name: 'Meeting room', x: 26, y: 4, w: 10, h: 16 },
  { id: 'lounge', name: 'Lounge', x: 26, y: 20, w: 10, h: 16 },
  { id: 'breakroom', name: 'Break room', x: 40, y: 4, w: 10, h: 32 },
];

export function roomAt(p: Point): RoomId {
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  for (const r of ROOMS) if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r.id;
  return 'corridor';
}

export function buildOffice(): OfficeMap {
  const floor: Floor[] = new Array(MAP_W * MAP_H).fill('void');
  const set = (x0: number, y0: number, w: number, h: number, f: Floor) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (inBounds(x, y)) floor[idx(x, y)] = f;
  };

  // Room shells: outline walls, a 3-tile white wall band on top, floors inside.
  const shell = (x0: number, x1: number, fill: () => void) => {
    set(x0, 0, x1 - x0 + 1, MAP_H, 'wall');
    set(x0 + 1, 1, x1 - x0 - 1, 3, 'wallFace');
    fill();
  };
  shell(0, 22, () => set(1, 4, 21, 32, 'wood'));
  shell(25, 36, () => {
    set(26, 4, 10, 16, 'woodDiag');
    set(26, 20, 10, 16, 'carpet');
  });
  shell(39, 50, () => set(40, 4, 10, 32, 'stone'));
  // Corridors
  set(23, 4, 2, 32, 'corridor');
  set(37, 4, 2, 32, 'corridor');
  // Doorways
  set(22, 15, 1, 3, 'wood');
  set(25, 15, 1, 3, 'woodDiag');
  set(36, 9, 1, 3, 'woodDiag');
  set(39, 9, 1, 3, 'stone');

  const furniture: Furniture[] = [];
  let fid = 0;
  const add = (kind: FurnitureKind, x: number, y: number, w = 1, h = 1, blocks = true, onWall = false) => {
    const f: Furniture = { id: `f${fid++}`, kind, x, y, w, h, blocks, onWall };
    furniture.push(f);
    return f;
  };

  const workstations: Workstation[] = [];
  const seats = new Set<number>();
  const addDesk = (label: string, room: RoomId, x: number, y: number) => {
    const desk = add('desk', x, y, 4, 2);
    add('chair', x + 1, y - 1, 1, 1, false);
    const seat = { x: x + 1, y: y - 1 };
    seats.add(idx(seat.x, seat.y));
    workstations.push({ id: `ws-${label}`, label, room, seat, deskFurnitureId: desk.id });
  };

  // ---- Room A: workspace -------------------------------------------------
  const cols = [2, 8, 14];
  const rows = [7, 13, 19, 25];
  let n = 1;
  for (const y of rows) for (const x of cols) addDesk(`A${String(n++).padStart(2, '0')}`, 'workspace', x, y);
  addDesk('A13', 'workspace', 8, 31); // manager desk, bottom like the reference

  add('clock', 1, 1, 1, 1, false, true);
  add('bookshelf', 3, 1, 1, 3, false, true);
  add('radio', 6, 2, 1, 1, false, true);
  add('wallCabinet', 8, 1, 2, 3, false, true);
  add('poster', 12, 1, 1, 2, false, true);
  add('chart', 16, 1, 1, 2, false, true);
  add('clock', 20, 1, 1, 1, false, true);

  add('plant', 1, 4);
  add('plant', 12, 4);
  add('bigPlant', 1, 11);
  add('bigPlant', 1, 33);
  add('plant', 16, 34);
  add('copier', 18, 9, 3, 2);
  add('lamp', 21, 9);
  add('bin', 13, 10);
  add('bin', 1, 22);
  add('cabinet', 21, 5, 1, 2);
  add('cabinet', 21, 20, 1, 2);
  add('cabinet', 21, 24, 1, 2);
  add('bookshelf', 21, 28, 1, 2);
  add('plant', 21, 34);

  // ---- Room B: meeting + lounge -------------------------------------------
  add('poster', 26, 1, 1, 2, false, true);
  add('radio', 28, 2, 1, 1, false, true);
  add('clock', 31, 1, 1, 1, false, true);
  add('bookshelf', 34, 1, 1, 3, false, true);
  add('plant', 26, 4);
  add('plant', 35, 4);
  add('bookshelf', 26, 7, 1, 2);
  add('bookshelf', 35, 6, 1, 2);
  add('meetingTable', 29, 9, 4, 3);
  add('blueChair', 30, 8);
  add('blueChair', 31, 8);
  add('blueChair', 30, 12);
  add('blueChair', 31, 12);
  add('blueChair', 28, 10);
  add('blueChair', 33, 10);
  add('plant', 35, 18);
  add('boxes', 26, 18);

  add('plant', 26, 20);
  add('plant', 35, 20);
  add('plant', 35, 35);
  add('bin', 26, 35);
  const sofaTop = add('sofaDown', 29, 23, 3, 1, false);
  add('coffeeTable', 29, 25, 3, 1);
  const sofaBottom = add('sofaUp', 29, 27, 3, 1, false);
  add('beanbag', 27, 23, 1, 1, false);
  add('beanbag', 34, 23, 1, 1, false);
  add('beanbag', 27, 28, 1, 1, false);
  add('beanbag', 34, 28, 1, 1, false);

  // ---- Room C: break room -------------------------------------------------
  add('vending', 41, 1, 2, 3, false, true);
  add('cooler', 44, 2, 1, 2, false, true);
  add('clock', 48, 1, 1, 1, false, true);
  addDesk('C01', 'breakroom', 41, 7);
  addDesk('C02', 'breakroom', 46, 7);
  addDesk('C03', 'breakroom', 41, 14);
  addDesk('C04', 'breakroom', 46, 14);
  addDesk('C05', 'breakroom', 41, 20);
  addDesk('C06', 'breakroom', 46, 20);
  addDesk('C07', 'breakroom', 41, 26);
  addDesk('C08', 'breakroom', 46, 26);
  add('plant', 40, 4);
  add('plant', 49, 4);
  add('plant', 49, 11);
  add('armchair', 41, 31, 1, 1, false);
  add('smallTable', 43, 31, 2, 1);
  add('armchair', 46, 31, 1, 1, false);
  add('stool', 41, 33);
  add('stool', 46, 33);
  add('cooler', 49, 30, 1, 2);
  add('bookshelf', 48, 33, 1, 2);
  add('bigPlant', 44, 34);
  add('bin', 49, 35);
  add('plant', 40, 35);

  // ---- Rest spots (separate places to sleep) --------------------------------
  const restSpots: RestSpot[] = [];
  let rid = 0;
  const rest = (room: RoomId, x: number, y: number, kind: RestSpot['kind'], facing: Facing) => {
    restSpots.push({ id: `rest${rid++}`, room, pos: { x, y }, kind, facing });
    if (kind !== 'floor') seats.add(idx(x, y));
  };
  for (let i = 0; i < 3; i++) rest('lounge', sofaTop.x + i, sofaTop.y, 'sofa', 'down');
  for (let i = 0; i < 3; i++) rest('lounge', sofaBottom.x + i, sofaBottom.y, 'sofa', 'up');
  rest('lounge', 27, 23, 'beanbag', 'down');
  rest('lounge', 34, 23, 'beanbag', 'down');
  rest('lounge', 27, 28, 'beanbag', 'down');
  rest('lounge', 34, 28, 'beanbag', 'down');
  rest('breakroom', 41, 31, 'armchair', 'down');
  rest('breakroom', 46, 31, 'armchair', 'down');
  const floorSpots: [number, number][] = [
    [28, 21], [33, 21], [27, 31], [30, 31], [33, 31], [29, 34], [32, 34], [34, 25], [42, 35], [47, 35],
  ];
  for (const [x, y] of floorSpots) rest(x < 37 ? 'lounge' : 'breakroom', x, y, 'floor', 'down');

  // ---- Collision -------------------------------------------------------------
  const blocked = new Uint8Array(MAP_W * MAP_H);
  for (let i = 0; i < floor.length; i++) {
    const f = floor[i];
    blocked[i] = f === 'void' || f === 'wall' || f === 'wallFace' ? 1 : 0;
  }
  for (const f of furniture) {
    if (!f.blocks || f.onWall) continue;
    for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) blocked[idx(x, y)] = 1;
  }
  for (const s of seats) blocked[s] = 1;

  const walkable: Point[] = [];
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (!blocked[idx(x, y)]) walkable.push({ x, y });

  return { width: MAP_W, height: MAP_H, floor, blocked, seats, furniture, workstations, restSpots, rooms: ROOMS, walkable };
}

let cached: OfficeMap | null = null;
export function getOffice(): OfficeMap {
  if (!cached) cached = buildOffice();
  return cached;
}
