// Zeichnen der Konstruktion: Werte -> Shapes in Pixelkoordinaten (lineare Achsen), Beschriftungen und Treffererkennung.
import { type View, xToPx, yToPx } from "../graph/viewport.ts";
import type { Shape } from "../graph/items.ts";
import { type Construction, kindOf } from "./model.ts";
import type { Values, Val, LineVal, PointVal } from "./compute.ts";

const TAU = Math.PI * 2;

export const GEO_COLORS: Record<string, string> = {
  point: "#2d70b3",
  line: "#c74440",
  segment: "#c74440",
  ray: "#c74440",
  vector: "#fa7e19",
  circle: "#388c46",
  arc: "#388c46",
  polygon: "#6042a6",
  measure: "#6b7280",
};

export interface GeoDrawn {
  id: string;
  color: string;
  shapes: Shape[];
  width?: number;
}

export interface GeoLabel {
  id: string;
  text: string;
  px: number;
  py: number;
  color: string;
}

export interface GeoScene {
  items: GeoDrawn[];
  labels: GeoLabel[];
  /** Pixelpositionen ausgewählter Punkte (für den Auswahlring) */
  halos: number[];
}

/** Schneidet die Gerade p + t·d (t in [lo, hi]) mit dem Fenster; liefert die Pixel-Endpunkte oder null (Liang–Barsky). */
export function clipLineToView(v: View, l: LineVal): [number, number, number, number] | null {
  const margin = 4;
  const x0 = xToPx(v, l.px);
  const y0 = yToPx(v, l.py);
  const ux = l.dx * v.sx;
  const uy = -l.dy * v.sy;
  let t0 = l.lo;
  let t1 = l.hi;
  const test = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (!(test(-ux, x0 + margin) && test(ux, v.width + margin - x0) && test(-uy, y0 + margin) && test(uy, v.height + margin - y0))) return null;
  if (!(t0 <= t1) || !Number.isFinite(t0) || !Number.isFinite(t1)) return null;
  return [x0 + t0 * ux, y0 + t0 * uy, x0 + t1 * ux, y0 + t1 * uy];
}

function arcPolyline(v: View, cx: number, cy: number, r: number, a0: number, sweep: number): number[] {
  const rpx = r * Math.max(v.sx, v.sy);
  if (!(rpx > 0.01) || !Number.isFinite(rpx)) return [];
  let start = a0;
  let span = sweep;
  // sehr große Kreise: nur das sichtbare Stück abtasten
  if (rpx > 3000 && sweep > 0.5) {
    const toCenter = Math.atan2(v.cy - cy, v.cx - cx);
    const half = Math.min(Math.PI, (Math.hypot(v.width, v.height) * 1.2) / rpx + 0.05);
    if (sweep >= TAU - 1e-9) {
      start = toCenter - half;
      span = 2 * half;
    }
  }
  const n = Math.min(2000, Math.max(24, Math.ceil((Math.abs(span) * rpx) / 5)));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = start + (span * i) / n;
    out.push(xToPx(v, cx + r * Math.cos(a)), yToPx(v, cy + r * Math.sin(a)));
  }
  return out;
}

function shapesOf(v: View, val: Val): Shape[] {
  switch (val.t) {
    case "point":
      return [{ type: "points", pts: [xToPx(v, val.x), yToPx(v, val.y)] }];
    case "line": case "segment": case "ray": {
      const seg = clipLineToView(v, val);
      return seg ? [{ type: "lines", lines: [seg] }] : [];
    }
    case "vector": {
      const ax = xToPx(v, val.px);
      const ay = yToPx(v, val.py);
      const bx = xToPx(v, val.px + val.dx * val.hi);
      const by = yToPx(v, val.py + val.dy * val.hi);
      const ang = Math.atan2(by - ay, bx - ax);
      const h = Math.min(14, Math.hypot(bx - ax, by - ay) / 2);
      const head = (s: number): number[] => [bx - h * Math.cos(ang + s), by - h * Math.sin(ang + s), bx, by];
      return [{ type: "lines", lines: [[ax, ay, bx, by], head(0.4), head(-0.4)] }];
    }
    case "circle": {
      const pl = arcPolyline(v, val.cx, val.cy, val.r, 0, TAU);
      return pl.length ? [{ type: "lines", lines: [pl] }] : [];
    }
    case "arc": {
      const pl = arcPolyline(v, val.cx, val.cy, val.r, val.a0, val.sweep);
      return pl.length ? [{ type: "lines", lines: [pl] }] : [];
    }
    case "polygon": {
      const poly: number[] = [];
      for (const p of val.pts) poly.push(xToPx(v, p.x), yToPx(v, p.y));
      return [{ type: "fillPoly", polys: [poly] }, { type: "lines", lines: [[...poly, poly[0], poly[1]]] }];
    }
    case "measure": {
      if (!val.arc) return [];
      const { x, y, from, delta } = val.arc;
      const cx = xToPx(v, x);
      const cy = yToPx(v, y);
      const n = 24;
      const pl: number[] = [];
      for (let i = 0; i <= n; i++) {
        const a = from + (delta * i) / n;
        pl.push(cx + 24 * Math.cos(a), cy - 24 * Math.sin(a));
      }
      return [{ type: "lines", lines: [pl] }];
    }
  }
}

export function renderGeometry(c: Construction, vals: Values, v: View, selected: ReadonlySet<string>, showLabels = true): GeoScene {
  const items: GeoDrawn[] = [];
  const labels: GeoLabel[] = [];
  const halos: number[] = [];
  // Reihenfolge: Flächen/Linien zuerst, Punkte zuletzt (liegen oben)
  const order = [...c.objects].sort((a, b) => (kindOf(a.def) === "point" ? 1 : 0) - (kindOf(b.def) === "point" ? 1 : 0));
  for (const o of order) {
    const val = vals[o.id];
    if (!val || o.hidden) continue;
    const kind = kindOf(o.def);
    const color = GEO_COLORS[kind];
    const shapes = shapesOf(v, val);
    const sel = selected.has(o.id);
    if (sel && kind !== "point" && kind !== "measure") {
      const strokes = shapes.filter((s) => s.type === "lines");
      if (strokes.length) items.push({ id: o.id, color: `${color}55`, shapes: strokes, width: 9 });
    }
    if (shapes.length) items.push({ id: o.id, color, shapes, width: kind === "measure" ? 1.5 : undefined });
    if (val.t === "point") {
      const px = xToPx(v, val.x);
      const py = yToPx(v, val.y);
      if (sel) halos.push(px, py);
      if (showLabels) labels.push({ id: o.id, text: o.name, px: px + 8, py: py - 10, color });
    } else if (val.t === "measure" && showLabels) {
      labels.push({ id: o.id, text: val.text, px: xToPx(v, val.anchor[0]) + 10, py: yToPx(v, val.anchor[1]) - 10, color: sel ? GEO_COLORS.point : color });
    }
  }
  return { items, labels, halos };
}

// ---------- Treffererkennung ----------
const distToSegment = (px: number, py: number, x0: number, y0: number, x1: number, y1: number): number => {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / l2));
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
};

function distanceTo(v: View, val: Val, px: number, py: number): number {
  switch (val.t) {
    case "point":
      return Math.hypot(px - xToPx(v, val.x), py - yToPx(v, val.y));
    case "line": case "segment": case "ray": {
      const s = clipLineToView(v, val);
      return s ? distToSegment(px, py, s[0], s[1], s[2], s[3]) : Infinity;
    }
    case "vector":
      return distToSegment(px, py, xToPx(v, val.px), yToPx(v, val.py), xToPx(v, val.px + val.dx * val.hi), yToPx(v, val.py + val.dy * val.hi));
    case "circle": {
      const wx = ((px - v.width / 2) / v.sx) + v.cx - val.cx;
      const wy = v.cy - ((py - v.height / 2) / v.sy) - val.cy;
      return Math.abs(Math.hypot(wx, wy) - val.r) * Math.max(v.sx, v.sy);
    }
    case "arc": {
      const wx = ((px - v.width / 2) / v.sx) + v.cx - val.cx;
      const wy = v.cy - ((py - v.height / 2) / v.sy) - val.cy;
      const ang = (((Math.atan2(wy, wx) - val.a0) % TAU) + TAU) % TAU;
      if (ang > val.sweep) {
        const e0: [number, number] = [val.cx + val.r * Math.cos(val.a0), val.cy + val.r * Math.sin(val.a0)];
        const a1 = val.a0 + val.sweep;
        const e1: [number, number] = [val.cx + val.r * Math.cos(a1), val.cy + val.r * Math.sin(a1)];
        return Math.min(
          Math.hypot(px - xToPx(v, e0[0]), py - yToPx(v, e0[1])),
          Math.hypot(px - xToPx(v, e1[0]), py - yToPx(v, e1[1]))
        );
      }
      return Math.abs(Math.hypot(wx, wy) - val.r) * Math.max(v.sx, v.sy);
    }
    case "polygon": {
      let best = Infinity;
      const n = val.pts.length;
      for (let i = 0; i < n; i++) {
        const a: PointVal = val.pts[i];
        const b: PointVal = val.pts[(i + 1) % n];
        best = Math.min(best, distToSegment(px, py, xToPx(v, a.x), yToPx(v, a.y), xToPx(v, b.x), yToPx(v, b.y)));
      }
      return best;
    }
    case "measure":
      return Infinity;
  }
}

/** Objekte unter dem Zeiger, nächstes zuerst; Punkte haben Vorrang vor Linien. */
export function hitTest(c: Construction, vals: Values, v: View, px: number, py: number, tol = 9): string[] {
  const hits: { id: string; d: number; pri: number }[] = [];
  for (const o of c.objects) {
    const val = vals[o.id];
    if (!val || o.hidden) continue;
    const d = distanceTo(v, val, px, py);
    if (d <= tol) hits.push({ id: o.id, d, pri: kindOf(o.def) === "point" ? 0 : 1 });
  }
  hits.sort((a, b) => a.pri - b.pri || a.d - b.d);
  return hits.map((h) => h.id);
}
