// Implizite Kurven F(x,y)=0 und Ungleichungen über Marching Squares auf einem Pixelraster.
import { type View, xFromPx, yFromPx } from "./viewport.ts";

export interface Grid {
  cell: number;
  cols: number;
  rows: number;
  /** Werte an den (cols+1)·(rows+1) Gitterpunkten, zeilenweise; NaN = nicht definiert. */
  v: Float64Array;
  /** Weltkoordinaten der Gitterspalten/-zeilen (für Masken). */
  xs: Float64Array;
  ys: Float64Array;
}

export function sampleGrid(h: (x: number, y: number) => number, view: View, cell = 4): Grid {
  const cols = Math.ceil(view.width / cell);
  const rows = Math.ceil(view.height / cell);
  const xs = new Float64Array(cols + 1);
  const ys = new Float64Array(rows + 1);
  for (let i = 0; i <= cols; i++) xs[i] = xFromPx(view, i * cell);
  for (let j = 0; j <= rows; j++) ys[j] = yFromPx(view, j * cell);
  const v = new Float64Array((cols + 1) * (rows + 1));
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      let val: number;
      try {
        val = h(xs[i], ys[j]);
      } catch {
        val = NaN;
      }
      v[j * (cols + 1) + i] = Number.isFinite(val) ? val : NaN;
    }
  }
  return { cell, cols, rows, v, xs, ys };
}

// Kanten einer Zelle: 0 oben, 1 rechts, 2 unten, 3 links
const SEGMENTS: Record<number, [number, number][]> = {
  1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]], 6: [[0, 2]], 7: [[3, 2]], 8: [[3, 2]],
  9: [[0, 2]], 11: [[1, 2]], 12: [[3, 1]], 13: [[0, 1]], 14: [[3, 0]],
};

interface Seg {
  k0: number;
  k1: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Höhenlinie F=0 als verkettete Polylinien (Pixelkoordinaten).
 * Kanten mit Vorzeichenwechsel durch eine Polstelle (|F| wächst zur Mitte hin) werden verworfen.
 */
export function contourLines(
  g: Grid,
  h: (x: number, y: number) => number,
  view: View,
  mask?: (x: number, y: number) => boolean
): number[][] {
  const { cell, cols, rows, v } = g;
  const stride = cols + 1;
  const segs: Seg[] = [];
  const okCache = new Map<number, boolean>();

  // Kante ok? Ein echter Nulldurchgang verläuft entlang der Kante (annähernd) monoton.
  // Bei einer Polstelle springt F dagegen über ±∞: dann ist die Folge der Zwischenwerte nicht monoton.
  const edgeOk = (key: number, i0: number, j0: number, i1: number, j1: number): boolean => {
    const c = okCache.get(key);
    if (c !== undefined) return c;
    const va = v[j0 * stride + i0];
    const vb = v[j1 * stride + i1];
    const sign = vb > va ? 1 : -1;
    const tol = 0.25 * Math.abs(vb - va);
    let prev = sign * va;
    let ok = true;
    for (const f of [0.25, 0.5, 0.75, 1]) {
      let cur: number;
      if (f === 1) cur = sign * vb;
      else {
        let hv: number;
        try {
          hv = h(xFromPx(view, (i0 + (i1 - i0) * f) * cell), yFromPx(view, (j0 + (j1 - j0) * f) * cell));
        } catch {
          hv = NaN;
        }
        cur = sign * hv;
      }
      if (!Number.isFinite(cur) || cur < prev - tol) {
        ok = false;
        break;
      }
      prev = cur;
    }
    okCache.set(key, ok);
    return ok;
  };

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = v[j * stride + i];
      const b = v[j * stride + i + 1];
      const c = v[(j + 1) * stride + i + 1];
      const d = v[(j + 1) * stride + i];
      if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c) || Number.isNaN(d)) continue;
      let idx = (a > 0 ? 1 : 0) | (b > 0 ? 2 : 0) | (c > 0 ? 4 : 0) | (d > 0 ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      if (mask && !mask(xFromPx(view, (i + 0.5) * cell), yFromPx(view, (j + 0.5) * cell))) continue;
      let pairs: [number, number][];
      if (idx === 5 || idx === 10) {
        const center = (a + b + c + d) / 4 > 0;
        const isolateAC: [number, number][] = [[3, 0], [1, 2]];
        const isolateBD: [number, number][] = [[0, 1], [3, 2]];
        pairs = idx === 5 ? (center ? isolateBD : isolateAC) : center ? isolateAC : isolateBD;
      } else pairs = SEGMENTS[idx];

      // Schnittpunkt und Kantenschlüssel
      const pt = (e: number): { k: number; x: number; y: number; ok: boolean } => {
        switch (e) {
          case 0: { const t = a / (a - b); return { k: (j * stride + i) * 2, x: (i + t) * cell, y: j * cell, ok: edgeOk((j * stride + i) * 2, i, j, i + 1, j) }; }
          case 1: { const t = b / (b - c); return { k: ((j * stride + i + 1) * 2) + 1, x: (i + 1) * cell, y: (j + t) * cell, ok: edgeOk(((j * stride + i + 1) * 2) + 1, i + 1, j, i + 1, j + 1) }; }
          case 2: { const t = d / (d - c); return { k: (((j + 1) * stride + i) * 2), x: (i + t) * cell, y: (j + 1) * cell, ok: edgeOk(((j + 1) * stride + i) * 2, i, j + 1, i + 1, j + 1) }; }
          default: { const t = a / (a - d); return { k: ((j * stride + i) * 2) + 1, x: i * cell, y: (j + t) * cell, ok: edgeOk(((j * stride + i) * 2) + 1, i, j, i, j + 1) }; }
        }
      };
      for (const [e0, e1] of pairs) {
        const p0 = pt(e0);
        const p1 = pt(e1);
        if (p0.ok && p1.ok) segs.push({ k0: p0.k, k1: p1.k, x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y });
      }
      idx = 0;
    }
  }
  return linkSegments(segs);
}

function linkSegments(segs: Seg[]): number[][] {
  const adj = new Map<number, number[]>();
  const add = (k: number, i: number): void => {
    const l = adj.get(k);
    if (l) l.push(i);
    else adj.set(k, [i]);
  };
  segs.forEach((s, i) => {
    add(s.k0, i);
    add(s.k1, i);
  });
  const used = new Uint8Array(segs.length);
  const out: number[][] = [];
  const next = (key: number): number => {
    const l = adj.get(key);
    if (!l) return -1;
    for (const i of l) if (!used[i]) return i;
    return -1;
  };
  for (let s0 = 0; s0 < segs.length; s0++) {
    if (used[s0]) continue;
    used[s0] = 1;
    const s = segs[s0];
    const tail: number[] = [s.x0, s.y0, s.x1, s.y1];
    let endKey = s.k1;
    let startKey = s.k0;
    for (let c = next(endKey); c >= 0; c = next(endKey)) {
      used[c] = 1;
      const g = segs[c];
      if (g.k0 === endKey) {
        tail.push(g.x1, g.y1);
        endKey = g.k1;
      } else {
        tail.push(g.x0, g.y0);
        endKey = g.k0;
      }
    }
    const head: number[] = [];
    for (let c = next(startKey); c >= 0; c = next(startKey)) {
      used[c] = 1;
      const g = segs[c];
      if (g.k0 === startKey) {
        head.push(g.x1, g.y1);
        startKey = g.k1;
      } else {
        head.push(g.x0, g.y0);
        startKey = g.k0;
      }
    }
    const line: number[] = [];
    for (let i = head.length - 2; i >= 0; i -= 2) line.push(head[i], head[i + 1]);
    line.push(...tail);
    out.push(line);
  }
  return out;
}

const TRUTH: Record<string, (x: number) => boolean> = {
  "<": (x) => x < 0,
  ">": (x) => x > 0,
  "<=": (x) => x <= 0,
  ">=": (x) => x >= 0,
};

/** Gefüllte Zellen als Rechtecke [x, y, w, h, …] (Pixel). Gitter k gehört zur Relation ops[k] (F = links − rechts). */
export function fillRects(grids: Grid[], ops: string[], mask?: (x: number, y: number) => boolean): number[] {
  const g0 = grids[0];
  const { cell, cols, rows } = g0;
  const stride = cols + 1;
  const truth = new Uint8Array(stride * (rows + 1));
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const k = j * stride + i;
      let ok = !mask || mask(g0.xs[i], g0.ys[j]);
      for (let q = 0; ok && q < grids.length; q++) {
        const val = grids[q].v[k];
        ok = !Number.isNaN(val) && (TRUTH[ops[q]] ?? TRUTH["<"])(val);
      }
      truth[k] = ok ? 1 : 0;
    }
  }
  const rects: number[] = [];
  for (let j = 0; j < rows; j++) {
    let start = -1;
    for (let i = 0; i <= cols; i++) {
      let filled = false;
      if (i < cols) {
        const n = truth[j * stride + i] + truth[j * stride + i + 1] + truth[(j + 1) * stride + i] + truth[(j + 1) * stride + i + 1];
        filled = n >= 2;
      }
      if (filled && start < 0) start = i;
      if (!filled && start >= 0) {
        rects.push(start * cell, j * cell, (i - start) * cell, cell);
        start = -1;
      }
    }
  }
  return rects;
}
