// Navigation grid + A* pathfinding over a built map (used by bots).
import { qRotate } from './math.mjs';

const navCache = new Map();

export function getNav(map) {
  let nav = navCache.get(map.id);
  if (!nav) { nav = new NavGrid(map); navCache.set(map.id, nav); }
  return nav;
}

const isPlatform = (p) => p.kind === 'box' && (p.mat === 'concrete' || p.mat === 'metal') && p.size[1] <= 3.6 && p.size[0] >= 6 && p.size[2] >= 6;

export class NavGrid {
  constructor(map, { cell = 2, clearance = 1.5 } = {}) {
    this.map = map;
    this.cell = cell;
    this.clearance = clearance;
    this.nx = Math.ceil(map.size[0] / cell) + 1;
    this.nz = Math.ceil(map.size[1] / cell) + 1;
    this.ox = -map.halfW;
    this.oz = -map.halfL;
    const n = this.nx * this.nz;
    this.blocked = new Uint8Array(n);
    this.cost = new Float32Array(n).fill(1);
    this.build();
  }

  idx(i, j) { return i + j * this.nx; }
  inBounds(i, j) { return i >= 0 && j >= 0 && i < this.nx && j < this.nz; }
  toCell(x, z) { return [Math.round((x - this.ox) / this.cell), Math.round((z - this.oz) / this.cell)]; }
  toWorld(i, j) { return [this.ox + i * this.cell, this.oz + j * this.cell]; }
  isBlocked(x, z) { const [i, j] = this.toCell(x, z); return !this.inBounds(i, j) || this.blocked[this.idx(i, j)] === 1; }

  /** Iterate grid cells whose centre lies inside an oriented rectangle. */
  forEachInRect(cx, cz, hw, hl, yaw, fn) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const ext = Math.hypot(hw, hl);
    const [i0, j0] = this.toCell(cx - ext, cz - ext);
    const [i1, j1] = this.toCell(cx + ext, cz + ext);
    for (let j = Math.max(0, j0); j <= Math.min(this.nz - 1, j1); j++) {
      for (let i = Math.max(0, i0); i <= Math.min(this.nx - 1, i1); i++) {
        const [x, z] = this.toWorld(i, j);
        const dx = x - cx, dz = z - cz;
        // world -> local (inverse yaw). local +z maps to world (sin yaw, cos yaw)
        const lx = dx * c - dz * s;
        const lz = dx * s + dz * c;
        if (Math.abs(lx) <= hw && Math.abs(lz) <= hl) fn(i, j);
      }
    }
  }

  build() {
    const map = this.map, cl = this.clearance;
    // terrain slope
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) {
        const [x, z] = this.toWorld(i, j);
        const h = map.heightAt(x, z);
        let maxSlope = 0;
        for (const [dx, dz] of [[this.cell, 0], [-this.cell, 0], [0, this.cell], [0, -this.cell]]) {
          const h2 = map.heightAt(x + dx, z + dz);
          maxSlope = Math.max(maxSlope, Math.abs(h2 - h) / this.cell);
        }
        const k = this.idx(i, j);
        if (maxSlope > 0.8) this.blocked[k] = 1;
        else this.cost[k] = 1 + maxSlope * 2.5;
        // map edge
        if (i === 0 || j === 0 || i === this.nx - 1 || j === this.nz - 1) this.blocked[k] = 1;
      }
    }
    const ramps = [];
    for (const p of map.props) {
      if (p.kind === 'ramp') { ramps.push(p); continue; }
      let hw = p.size[0] / 2, hl = p.size[2] / 2;
      if (p.kind === 'tree') { hw = 0.6; hl = 0.6; }
      if (p.size[1] <= 0.45) {
        // low pad: drivable
        this.forEachInRect(p.pos[0], p.pos[2], hw, hl, p.yaw, (i, j) => { const k = this.idx(i, j); if (!this.blocked[k]) this.cost[k] = Math.max(this.cost[k], 1.1); });
        continue;
      }
      if (isPlatform(p)) {
        // block only a frame around the platform edge; interior stays walkable (reached via ramps)
        const inner = new Set();
        this.forEachInRect(p.pos[0], p.pos[2], hw - cl, hl - cl, p.yaw, (i, j) => inner.add(this.idx(i, j)));
        this.forEachInRect(p.pos[0], p.pos[2], hw + cl, hl + cl, p.yaw, (i, j) => { const k = this.idx(i, j); if (!inner.has(k)) this.blocked[k] = 1; });
        continue;
      }
      this.forEachInRect(p.pos[0], p.pos[2], hw + cl, hl + cl, p.yaw, (i, j) => { this.blocked[this.idx(i, j)] = 1; });
    }
    // ramps are drivable and open gateways into platforms
    for (const p of ramps) {
      const horiz = p.size[2] * Math.cos(p.pitch || 0);
      this.forEachInRect(p.pos[0], p.pos[2], p.size[0] / 2 - 0.3, horiz / 2 + cl, p.yaw, (i, j) => { const k = this.idx(i, j); this.blocked[k] = 0; this.cost[k] = 1.3; });
      // but keep the ramp's sides blocked (falling off the side is bad)
    }
  }

  nearestFree(i, j, maxR = 8) {
    if (this.inBounds(i, j) && !this.blocked[this.idx(i, j)]) return [i, j];
    for (let r = 1; r <= maxR; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const a = i + di, b = j + dj;
          if (this.inBounds(a, b) && !this.blocked[this.idx(a, b)]) return [a, b];
        }
      }
    }
    return null;
  }

  /** Supercover line test between two cells: true if every crossed cell is free. */
  lineFree(i0, j0, i1, j1) {
    let di = Math.abs(i1 - i0), dj = Math.abs(j1 - j0);
    let i = i0, j = j0;
    const si = i1 > i0 ? 1 : -1, sj = j1 > j0 ? 1 : -1;
    let err = di - dj;
    const n = di + dj;
    for (let k = 0; k <= n; k++) {
      if (!this.inBounds(i, j) || this.blocked[this.idx(i, j)]) return false;
      if (i === i1 && j === j1) return true;
      const e2 = 2 * err;
      if (e2 > -dj && e2 < di) {
        // diagonal step: check both orthogonal neighbours to avoid corner cutting
        if (this.blocked[this.idx(i + si, j)] || this.blocked[this.idx(i, j + sj)]) return false;
        err -= dj; err += di; i += si; j += sj;
      } else if (e2 > -dj) { err -= dj; i += si; }
      else { err += di; j += sj; }
    }
    return true;
  }

  /**
   * A* path from world (x,z) to world (x,z). Returns array of [x,z] waypoints (smoothed) or null.
   */
  findPath(from, to, maxIter = 40000) {
    const s0 = this.toCell(from[0], from[1]);
    const g0 = this.toCell(to[0], to[1]);
    const s = this.nearestFree(s0[0], s0[1], 6);
    const g = this.nearestFree(g0[0], g0[1], 6);
    if (!s || !g) return null;
    const nx = this.nx, nz = this.nz;
    const start = this.idx(s[0], s[1]), goal = this.idx(g[0], g[1]);
    if (start === goal) return [[to[0], to[1]]];
    const gScore = new Float32Array(nx * nz).fill(Infinity);
    const came = new Int32Array(nx * nz).fill(-1);
    const closed = new Uint8Array(nx * nz);
    gScore[start] = 0;
    // binary heap of [f, idx]
    const heap = [];
    const push = (f, k) => { heap.push([f, k]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
    const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
    const h = (k) => { const i = k % nx, j = (k / nx) | 0; const di = Math.abs(i - g[0]), dj = Math.abs(j - g[1]); return Math.max(di, dj) + 0.4142 * Math.min(di, dj); };
    push(h(start), start);
    let iter = 0;
    const N = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];
    while (heap.length && iter++ < maxIter) {
      const [, k] = pop();
      if (closed[k]) continue;
      if (k === goal) break;
      closed[k] = 1;
      const i = k % nx, j = (k / nx) | 0;
      for (const [di, dj, w] of N) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
        const nk = a + b * nx;
        if (this.blocked[nk] || closed[nk]) continue;
        if (di && dj && (this.blocked[i + di + j * nx] || this.blocked[i + (j + dj) * nx])) continue;
        const ng = gScore[k] + w * this.cost[nk];
        if (ng < gScore[nk]) { gScore[nk] = ng; came[nk] = k; push(ng + h(nk), nk); }
      }
    }
    if (came[goal] < 0 && goal !== start) return null;
    const cells = [];
    for (let k = goal; k !== -1; k = came[k]) { cells.push(k); if (k === start) break; }
    cells.reverse();
    // string pulling
    const out = [];
    let cur = 0;
    while (cur < cells.length - 1) {
      let best = cur + 1;
      for (let j = cells.length - 1; j > cur + 1; j--) {
        const a = cells[cur], b = cells[j];
        if (this.lineFree(a % nx, (a / nx) | 0, b % nx, (b / nx) | 0)) { best = j; break; }
      }
      out.push(cells[best]);
      cur = best;
    }
    const pts = out.map((k) => this.toWorld(k % nx, (k / nx) | 0));
    if (pts.length) pts[pts.length - 1] = [to[0], to[1]];
    return pts;
  }

  /** Move a world xz point to the nearest free cell centre if it is blocked. */
  freePoint(x, z, maxR = 6) {
    const [i, j] = this.toCell(x, z);
    if (this.inBounds(i, j) && !this.blocked[this.idx(i, j)]) return [x, z];
    const f = this.nearestFree(i, j, maxR);
    return f ? this.toWorld(f[0], f[1]) : [x, z];
  }

  /** Debug: ASCII dump of the grid. */
  dump() {
    const rows = [];
    for (let j = this.nz - 1; j >= 0; j -= 1) {
      let row = '';
      for (let i = 0; i < this.nx; i++) row += this.blocked[this.idx(i, j)] ? '#' : (this.cost[this.idx(i, j)] > 1.8 ? '^' : '.');
      rows.push(row);
    }
    return rows.join('\n');
  }
}

/** Nudge spawns and objectives of a built map onto free nav cells (idempotent). */
export function finalizeMap(map) {
  if (map.finalized) return map;
  const nav = getNav(map);
  const fix = (pos) => { const [x, z] = nav.freePoint(pos[0], pos[2]); return [x, map.surfaceAt(x, z) + (pos[1] - map.heightAt(pos[0], pos[2]) > 1 ? 1.2 : 0), z]; };
  for (const key of ['dm', 'red', 'blue']) map.spawns[key] = map.spawns[key].map((s) => ({ pos: fix(s.pos), yaw: s.yaw }));
  map.drops = map.drops.map((p) => { const [x, z] = nav.freePoint(p[0], p[2]); return [x, map.surfaceAt(x, z), z]; });
  map.gold = map.gold.map((p) => { const [x, z] = nav.freePoint(p[0], p[2]); return [x, map.surfaceAt(x, z), z]; });
  map.points = map.points.map((p) => { const [x, z] = nav.freePoint(p.pos[0], p.pos[2]); return { id: p.id, pos: [x, map.surfaceAt(x, z), z] }; });
  map.finalized = true;
  return map;
}
