import type { Point } from '../types';

export interface Grid {
  width: number;
  height: number;
  /** 1 = blocked */
  blocked: Uint8Array;
}

/** Small binary min-heap keyed by f-score. */
class Heap {
  private items: number[] = [];
  constructor(private score: Float64Array) {}
  get size() {
    return this.items.length;
  }
  push(n: number) {
    const a = this.items;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.score[a[p]] <= this.score[a[i]]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.score[a[l]] < this.score[a[m]]) m = l;
        if (r < a.length && this.score[a[r]] < this.score[a[m]]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * 4-directional A*. Start and goal may sit on blocked tiles (chairs, sofas),
 * everything in between must be walkable. Returns the tiles after `start`
 * up to and including `goal`, an empty array if start === goal, or null if
 * there is no route.
 */
export function findPath(grid: Grid, start: Point, goal: Point): Point[] | null {
  const { width: W, height: H, blocked } = grid;
  const sx = Math.round(start.x);
  const sy = Math.round(start.y);
  const gx = Math.round(goal.x);
  const gy = Math.round(goal.y);
  if (gx < 0 || gy < 0 || gx >= W || gy >= H || sx < 0 || sy < 0 || sx >= W || sy >= H) return null;
  if (sx === gx && sy === gy) return [];

  const N = W * H;
  const startI = sy * W + sx;
  const goalI = gy * W + gx;
  const g = new Float64Array(N).fill(Infinity);
  const f = new Float64Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const heap = new Heap(f);
  const h = (i: number) => Math.abs((i % W) - gx) + Math.abs(((i / W) | 0) - gy);

  g[startI] = 0;
  f[startI] = h(startI);
  heap.push(startI);

  const dirs = [1, -1, W, -W];
  while (heap.size) {
    const cur = heap.pop();
    if (cur === goalI) {
      const out: Point[] = [];
      for (let c = cur; c !== startI; c = came[c]) out.push({ x: c % W, y: (c / W) | 0 });
      return out.reverse();
    }
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % W;
    for (const d of dirs) {
      const nb = cur + d;
      if (nb < 0 || nb >= N) continue;
      // prevent wrapping across rows on horizontal moves
      if ((d === 1 && cx === W - 1) || (d === -1 && cx === 0)) continue;
      if (closed[nb]) continue;
      if (blocked[nb] && nb !== goalI) continue;
      // tiny turn penalty keeps paths straight and readable
      const prev = came[cur];
      const turn = prev >= 0 && cur - prev !== d ? 0.001 : 0;
      const tentative = g[cur] + 1 + turn;
      if (tentative < g[nb]) {
        came[nb] = cur;
        g[nb] = tentative;
        f[nb] = tentative + h(nb);
        heap.push(nb);
      }
    }
  }
  return null;
}
