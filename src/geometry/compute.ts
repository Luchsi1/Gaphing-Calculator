// Auswertung der Konstruktion: numerische Werte (für Zeichnung) und – wo möglich – exakte Werte (Expr, für LaTeX).
// Exakt sind: Punkte mit „glatten“ Dezimalkoordinaten, Mittelpunkte, Schnittpunkte von Geraden/Strecken/Strahlen,
// Abstände, Umfänge, Flächen, Kreisgleichungen sowie Winkel mit bekanntem Kosinus.
import {
  type Expr, num, add, mul, pow, sym, simplify, rationalOf, toLatex, NEG1,
} from "../engine/index.ts";
import { type Construction, type GObject, type Def, find } from "./model.ts";

const TAU = Math.PI * 2;
const EPS = 1e-12;

// ---------- Exakte Hilfsfunktionen ----------
const S = simplify;
const plus = (a: Expr, b: Expr): Expr => S(add(a, b));
const sub = (a: Expr, b: Expr): Expr => S(add(a, mul(NEG1, b)));
const times = (a: Expr, b: Expr): Expr => S(mul(a, b));
const div = (a: Expr, b: Expr): Expr => S(mul(a, pow(b, NEG1)));
const sqrtE = (a: Expr): Expr => S(pow(a, num(1, 2)));
const isZeroE = (e: Expr): boolean => e.t === "num" && e.n === 0n;

/** Exakte Darstellung einer Koordinate, falls sie eine Dezimalzahl mit höchstens 6 Nachkommastellen ist. */
export function exactOf(x: number): Expr | null {
  if (!Number.isFinite(x) || Math.abs(x) >= 1e6) return null;
  const r = Math.round(x * 1e6);
  return Math.abs(x - r / 1e6) < 1e-12 ? rationalOf(x) : null;
}

// ---------- Werte ----------
export interface ExPt { x: Expr; y: Expr }

export interface PointVal { t: "point"; x: number; y: number; ex?: ExPt }

/** Gerade, Strecke, Strahl, Vektor: Aufpunkt p, Einheitsrichtung d, gültiger Parameterbereich [lo, hi]. */
export interface LineVal {
  t: "line" | "segment" | "ray" | "vector";
  px: number; py: number; dx: number; dy: number; lo: number; hi: number;
  ex?: { px: Expr; py: Expr; dx: Expr; dy: Expr };
}

export interface CircleVal { t: "circle"; cx: number; cy: number; r: number; ex?: { cx: Expr; cy: Expr; r2: Expr } }
export interface ArcVal { t: "arc"; cx: number; cy: number; r: number; a0: number; sweep: number }
export interface PolygonVal { t: "polygon"; pts: PointVal[] }

export type MeasureKind = "distance" | "angle" | "area" | "perimeter";
export interface MeasureVal {
  t: "measure";
  mk: MeasureKind;
  value: number;
  latex: string;
  /** Kurztext für die Beschriftung in der Zeichnung */
  text: string;
  exact: boolean;
  anchor: [number, number];
  /** Winkelmarkierung: Scheitel, Startrichtung und Drehwinkel (mit Vorzeichen) */
  arc?: { x: number; y: number; from: number; delta: number };
}

export type Val = PointVal | LineVal | CircleVal | ArcVal | PolygonVal | MeasureVal;
export type Values = Record<string, Val | null>;

const isLineLike = (v: Val | null | undefined): v is LineVal => !!v && (v.t === "line" || v.t === "segment" || v.t === "ray" || v.t === "vector");

// ---------- Zahlenformat ----------
export function fmt(x: number): string {
  if (!Number.isFinite(x)) return "?";
  const s = Number(x.toPrecision(6)).toString();
  return s === "-0" ? "0" : s;
}

const approxLatex = (x: number): string => `\\approx ${fmt(x)}`;

/** „Exakt (≈ Näherung)“ als LaTeX; die Näherung entfällt bei ganzen Zahlen und Brüchen. */
function valueLatex(e: Expr, approx: number): string {
  const l = toLatex(e);
  return e.t === "num" ? l : `${l} ${approxLatex(approx)}`;
}

// ---------- Konstruktion von Linien ----------
function makeLine(t: LineVal["t"], a: PointVal, b: PointVal): LineVal | null {
  const ddx = b.x - a.x;
  const ddy = b.y - a.y;
  const len = Math.hypot(ddx, ddy);
  if (!(len > EPS)) return null;
  const hi = t === "line" || t === "ray" ? Infinity : len;
  const v: LineVal = { t, px: a.x, py: a.y, dx: ddx / len, dy: ddy / len, lo: t === "line" ? -Infinity : 0, hi };
  if (a.ex && b.ex) v.ex = { px: a.ex.x, py: a.ex.y, dx: sub(b.ex.x, a.ex.x), dy: sub(b.ex.y, a.ex.y) };
  return v;
}

function lineThrough(p: PointVal, dx: number, dy: number, exd?: { dx: Expr; dy: Expr }): LineVal | null {
  const len = Math.hypot(dx, dy);
  if (!(len > EPS)) return null;
  const v: LineVal = { t: "line", px: p.x, py: p.y, dx: dx / len, dy: dy / len, lo: -Infinity, hi: Infinity };
  if (p.ex && exd) v.ex = { px: p.ex.x, py: p.ex.y, dx: exd.dx, dy: exd.dy };
  return v;
}

// ---------- Schnittpunkte ----------
const angleIn = (cx: number, cy: number, a0: number, sweep: number, x: number, y: number): boolean => {
  if (sweep >= TAU - 1e-12) return true;
  const d = (((Math.atan2(y - cy, x - cx) - a0) % TAU) + TAU) % TAU;
  return d <= sweep + 1e-9 || d >= TAU - 1e-9;
};

type CircleLike = { cx: number; cy: number; r: number; a0?: number; sweep?: number };

const asCircle = (v: Val | null | undefined): CircleLike | null =>
  v && v.t === "circle" ? v : v && v.t === "arc" ? v : null;

const onCircleRange = (c: CircleLike, p: PointVal): boolean =>
  c.a0 === undefined || c.sweep === undefined ? true : angleIn(c.cx, c.cy, c.a0, c.sweep, p.x, p.y);

const inRange = (l: LineVal, t: number): boolean => t >= l.lo - 1e-9 && t <= l.hi + 1e-9;

/**
 * Alle Schnittpunkte zweier Kurven in fester Reihenfolge. Plätze ohne Punkt (außerhalb von Strecke/Strahl/Bogen) sind null.
 * Gerade–Gerade: 1 Platz. Gerade–Kreis: nach wachsendem Parameter entlang der Geraden. Kreis–Kreis: links/rechts der
 * Verbindung der Mittelpunkte (Reihenfolge der beiden Kreise).
 */
export function rawIntersections(a: Val | null, b: Val | null): (PointVal | null)[] {
  if (!a || !b) return [];
  if (isLineLike(a) && isLineLike(b)) {
    const cross = a.dx * b.dy - a.dy * b.dx;
    if (Math.abs(cross) < 1e-10) return [];
    const wx = b.px - a.px;
    const wy = b.py - a.py;
    const t = (wx * b.dy - wy * b.dx) / cross;
    const s = (wx * a.dy - wy * a.dx) / cross;
    if (!inRange(a, t) || !inRange(b, s)) return [null];
    const p: PointVal = { t: "point", x: a.px + t * a.dx, y: a.py + t * a.dy };
    if (a.ex && b.ex) {
      const ex = a.ex;
      const bx = b.ex;
      const crossE = sub(times(ex.dx, bx.dy), times(ex.dy, bx.dx));
      if (!isZeroE(crossE)) {
        const wxE = sub(bx.px, ex.px);
        const wyE = sub(bx.py, ex.py);
        const tE = div(sub(times(wxE, bx.dy), times(wyE, bx.dx)), crossE);
        p.ex = { x: plus(ex.px, times(tE, ex.dx)), y: plus(ex.py, times(tE, ex.dy)) };
      }
    }
    return [p];
  }
  const line = isLineLike(a) ? a : isLineLike(b) ? b : null;
  const circ = asCircle(a) ?? asCircle(b);
  if (line && circ) {
    const fx = line.px - circ.cx;
    const fy = line.py - circ.cy;
    const bb = fx * line.dx + fy * line.dy;
    const cc = fx * fx + fy * fy - circ.r * circ.r;
    const disc = bb * bb - cc;
    const tol = 1e-9 * Math.max(1, circ.r * circ.r);
    if (disc < -tol) return [];
    const ts = disc <= tol ? [-bb] : [-bb - Math.sqrt(disc), -bb + Math.sqrt(disc)];
    return ts.map((t) => {
      const p: PointVal = { t: "point", x: line.px + t * line.dx, y: line.py + t * line.dy };
      return inRange(line, t) && onCircleRange(circ, p) ? p : null;
    });
  }
  const c1 = asCircle(a);
  const c2 = asCircle(b);
  if (c1 && c2) {
    const dx = c2.cx - c1.cx;
    const dy = c2.cy - c1.cy;
    const d = Math.hypot(dx, dy);
    if (!(d > EPS) || d > c1.r + c2.r + 1e-9 || d < Math.abs(c1.r - c2.r) - 1e-9) return [];
    const aa = (c1.r * c1.r - c2.r * c2.r + d * d) / (2 * d);
    const h2 = c1.r * c1.r - aa * aa;
    const h = h2 > 0 ? Math.sqrt(h2) : 0;
    const ux = dx / d;
    const uy = dy / d;
    const bx = c1.cx + aa * ux;
    const by = c1.cy + aa * uy;
    const pts: PointVal[] = h < 1e-9 * Math.max(1, c1.r)
      ? [{ t: "point", x: bx, y: by }]
      : [{ t: "point", x: bx - h * uy, y: by + h * ux }, { t: "point", x: bx + h * uy, y: by - h * ux }];
    return pts.map((p) => (onCircleRange(c1, p) && onCircleRange(c2, p) ? p : null));
  }
  return [];
}

// ---------- Auswertung ----------
export function evaluate(c: Construction): Values {
  const vals: Values = {};
  const pt = (id: string): PointVal | null => {
    const v = vals[id];
    return v && v.t === "point" ? v : null;
  };
  for (const o of c.objects) {
    try {
      vals[o.id] = evalObject(c, o.def, vals, pt);
    } catch {
      vals[o.id] = null;
    }
  }
  return vals;
}

function evalObject(c: Construction, d: Def, vals: Values, pt: (id: string) => PointVal | null): Val | null {
  const name = (id: string): string => find(c, id)?.name ?? "?";
  switch (d.k) {
    case "point": {
      const ex = exactOf(d.x);
      const ey = exactOf(d.y);
      return { t: "point", x: d.x, y: d.y, ...(ex && ey ? { ex: { x: ex, y: ey } } : {}) };
    }
    case "midpoint": {
      const a = pt(d.a);
      const b = pt(d.b);
      if (!a || !b) return null;
      const p: PointVal = { t: "point", x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (a.ex && b.ex) p.ex = { x: times(num(1, 2), plus(a.ex.x, b.ex.x)), y: times(num(1, 2), plus(a.ex.y, b.ex.y)) };
      return p;
    }
    case "intersect": {
      const list = rawIntersections(vals[d.a] ?? null, vals[d.b] ?? null);
      return list[d.n] ?? null;
    }
    case "line": case "segment": case "ray": case "vector": {
      const a = pt(d.a);
      const b = pt(d.b);
      return a && b ? makeLine(d.k, a, b) : null;
    }
    case "circle": {
      const m = pt(d.c);
      const p = pt(d.p);
      if (!m || !p) return null;
      const r = Math.hypot(p.x - m.x, p.y - m.y);
      if (!(r > EPS)) return null;
      const v: CircleVal = { t: "circle", cx: m.x, cy: m.y, r };
      if (m.ex && p.ex) {
        const ddx = sub(p.ex.x, m.ex.x);
        const ddy = sub(p.ex.y, m.ex.y);
        v.ex = { cx: m.ex.x, cy: m.ex.y, r2: plus(times(ddx, ddx), times(ddy, ddy)) };
      }
      return v;
    }
    case "circler": {
      const m = pt(d.c);
      if (!m) return null;
      const v: CircleVal = { t: "circle", cx: m.x, cy: m.y, r: d.r };
      const er = exactOf(d.r);
      if (m.ex && er) v.ex = { cx: m.ex.x, cy: m.ex.y, r2: times(er, er) };
      return v;
    }
    case "arc": {
      const m = pt(d.c);
      const s = pt(d.s);
      const e = pt(d.e);
      if (!m || !s || !e) return null;
      const r = Math.hypot(s.x - m.x, s.y - m.y);
      if (!(r > EPS) || !(Math.hypot(e.x - m.x, e.y - m.y) > EPS)) return null;
      const a0 = Math.atan2(s.y - m.y, s.x - m.x);
      const a1 = Math.atan2(e.y - m.y, e.x - m.x);
      let sweep = (((a1 - a0) % TAU) + TAU) % TAU;
      if (sweep < 1e-12) sweep = TAU;
      return { t: "arc", cx: m.x, cy: m.y, r, a0, sweep };
    }
    case "polygon": {
      const pts = d.pts.map(pt);
      return pts.every((p): p is PointVal => p !== null) ? { t: "polygon", pts } : null;
    }
    case "perp": case "parallel": {
      const l = vals[d.line];
      const p = pt(d.p);
      if (!isLineLike(l) || !p) return null;
      if (d.k === "perp") return lineThrough(p, -l.dy, l.dx, l.ex ? { dx: neg(l.ex.dy), dy: l.ex.dx } : undefined);
      return lineThrough(p, l.dx, l.dy, l.ex ? { dx: l.ex.dx, dy: l.ex.dy } : undefined);
    }
    case "perpbis": {
      const a = pt(d.a);
      const b = pt(d.b);
      if (!a || !b) return null;
      const m: PointVal = { t: "point", x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (a.ex && b.ex) m.ex = { x: times(num(1, 2), plus(a.ex.x, b.ex.x)), y: times(num(1, 2), plus(a.ex.y, b.ex.y)) };
      const ddx = b.x - a.x;
      const ddy = b.y - a.y;
      const exd = a.ex && b.ex ? { dx: neg(sub(b.ex.y, a.ex.y)), dy: sub(b.ex.x, a.ex.x) } : undefined;
      return lineThrough(m, -ddy, ddx, exd);
    }
    case "anglebis": {
      const a = pt(d.a);
      const b = pt(d.b);
      const cc = pt(d.c);
      if (!a || !b || !cc) return null;
      const ux = a.x - b.x;
      const uy = a.y - b.y;
      const vx = cc.x - b.x;
      const vy = cc.y - b.y;
      const lu = Math.hypot(ux, uy);
      const lv = Math.hypot(vx, vy);
      if (!(lu > EPS) || !(lv > EPS)) return null;
      let sx = ux / lu + vx / lv;
      let sy = uy / lu + vy / lv;
      if (Math.hypot(sx, sy) < 1e-9) {
        sx = -uy;
        sy = ux;
      }
      return lineThrough(b, sx, sy);
    }
    case "distance": {
      const a = pt(d.a);
      const b = pt(d.b);
      if (!a || !b) return null;
      const value = Math.hypot(b.x - a.x, b.y - a.y);
      let latex = `\\left|${name(d.a)}${name(d.b)}\\right| ${approxLatex(value)}`;
      let exact = false;
      if (a.ex && b.ex) {
        const ddx = sub(b.ex.x, a.ex.x);
        const ddy = sub(b.ex.y, a.ex.y);
        latex = `\\left|${name(d.a)}${name(d.b)}\\right| = ${valueLatex(sqrtE(plus(times(ddx, ddx), times(ddy, ddy))), value)}`;
        exact = true;
      }
      return { t: "measure", mk: "distance", value, latex, text: `|${name(d.a)}${name(d.b)}| = ${fmt(value)}`, exact, anchor: [(a.x + b.x) / 2, (a.y + b.y) / 2] };
    }
    case "angle": {
      const a = pt(d.a);
      const b = pt(d.b);
      const cc = pt(d.c);
      if (!a || !b || !cc) return null;
      const ux = a.x - b.x;
      const uy = a.y - b.y;
      const vx = cc.x - b.x;
      const vy = cc.y - b.y;
      const lu = Math.hypot(ux, uy);
      const lv = Math.hypot(vx, vy);
      if (!(lu > EPS) || !(lv > EPS)) return null;
      const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv)));
      const theta = Math.acos(cos);
      const deg = (theta * 180) / Math.PI;
      const cross = ux * vy - uy * vx;
      const label = `\\angle ${name(d.a)}${name(d.b)}${name(d.c)}`;
      let latex = `${label} ${approxLatex(deg)}^\\circ`;
      let exact = false;
      if (a.ex && b.ex && cc.ex) {
        const e1x = sub(a.ex.x, b.ex.x);
        const e1y = sub(a.ex.y, b.ex.y);
        const e2x = sub(cc.ex.x, b.ex.x);
        const e2y = sub(cc.ex.y, b.ex.y);
        const dot = plus(times(e1x, e2x), times(e1y, e2y));
        const nn = times(sqrtE(plus(times(e1x, e1x), times(e1y, e1y))), sqrtE(plus(times(e2x, e2x), times(e2y, e2y))));
        const cosE = div(dot, nn);
        const nice = NICE_ANGLES.find((q) => Math.abs(q.cos - cos) < 1e-9);
        latex = nice ? `${label} = ${nice.deg}^\\circ` : `${label} = \\arccos\\left(${toLatex(cosE)}\\right) ${approxLatex(deg)}^\\circ`;
        exact = true;
      }
      return {
        t: "measure", mk: "angle", value: deg, latex, text: `${fmt(deg)}°`, exact, anchor: [b.x, b.y],
        arc: { x: b.x, y: b.y, from: Math.atan2(uy, ux), delta: cross >= 0 ? theta : -theta },
      };
    }
    case "area": case "perimeter": {
      const o = find(c, d.of);
      const v = vals[d.of];
      if (!o || !v) return null;
      return areaOrPerimeter(d.k, v, o.name);
    }
  }
}

const neg = (a: Expr): Expr => S(mul(NEG1, a));

const R2 = Math.SQRT2 / 2;
const R3 = Math.sqrt(3) / 2;
const NICE_ANGLES = [
  { cos: 1, deg: 0 }, { cos: R3, deg: 30 }, { cos: R2, deg: 45 }, { cos: 0.5, deg: 60 }, { cos: 0, deg: 90 },
  { cos: -0.5, deg: 120 }, { cos: -R2, deg: 135 }, { cos: -R3, deg: 150 }, { cos: -1, deg: 180 },
];

function areaOrPerimeter(k: "area" | "perimeter", v: Val, name: string): MeasureVal | null {
  const sym_ = k === "area" ? "A" : "U";
  if (v.t === "circle") {
    const value = k === "area" ? Math.PI * v.r * v.r : TAU * v.r;
    let latex = `${sym_}_{${name}} ${approxLatex(value)}`;
    let exact = false;
    if (v.ex) {
      const e = k === "area" ? times(sym("pi"), v.ex.r2) : times(times(num(2), sym("pi")), sqrtE(v.ex.r2));
      latex = `${sym_}_{${name}} = ${valueLatex(e, value)}`;
      exact = true;
    }
    return { t: "measure", mk: k, value, latex, text: `${sym_} = ${fmt(value)}`, exact, anchor: [v.cx, v.cy] };
  }
  if (v.t !== "polygon") return null;
  const pts = v.pts;
  const n = pts.length;
  const cx = pts.reduce((s, p) => s + p.x, 0) / n;
  const cy = pts.reduce((s, p) => s + p.y, 0) / n;
  const allExact = pts.every((p) => p.ex);
  if (k === "area") {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % n];
      sum += p.x * q.y - q.x * p.y;
    }
    const value = Math.abs(sum) / 2;
    let latex = `${sym_}_{${name}} ${approxLatex(value)}`;
    if (allExact) {
      let e: Expr = num(0);
      for (let i = 0; i < n; i++) {
        const p = pts[i].ex as ExPt;
        const q = pts[(i + 1) % n].ex as ExPt;
        e = plus(e, sub(times(p.x, q.y), times(q.x, p.y)));
      }
      e = times(num(sum < 0 ? -1 : 1, 2), e);
      latex = `${sym_}_{${name}} = ${valueLatex(e, value)}`;
    }
    return { t: "measure", mk: k, value, latex, text: `${sym_} = ${fmt(value)}`, exact: allExact, anchor: [cx, cy] };
  }
  let value = 0;
  let e: Expr = num(0);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    value += Math.hypot(q.x - p.x, q.y - p.y);
    if (allExact) {
      const ddx = sub((q.ex as ExPt).x, (p.ex as ExPt).x);
      const ddy = sub((q.ex as ExPt).y, (p.ex as ExPt).y);
      e = plus(e, sqrtE(plus(times(ddx, ddx), times(ddy, ddy))));
    }
  }
  const latex = allExact ? `${sym_}_{${name}} = ${valueLatex(e, value)}` : `${sym_}_{${name}} ${approxLatex(value)}`;
  return { t: "measure", mk: k, value, latex, text: `${sym_} = ${fmt(value)}`, exact: allExact, anchor: [cx, cy] };
}

// ---------- Beschreibung (LaTeX) ----------
const bigGcd = (a: bigint, b: bigint): bigint => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
};

/** Gleichung a·x + b·y = c einer Geraden mit exaktem Aufpunkt und Richtung; ganzzahlig normalisiert, falls rational. */
function exactLineEquation(l: NonNullable<LineVal["ex"]>): string {
  let a = l.dy;
  let b = neg(l.dx);
  let c = sub(times(l.dy, l.px), times(l.dx, l.py));
  const all = [a, b, c];
  if (all.every((e) => e.t === "num")) {
    const nums = all as { t: "num"; n: bigint; d: bigint }[];
    let lcm = 1n;
    for (const q of nums) lcm = (lcm / bigGcd(lcm, q.d)) * q.d;
    const ints = nums.map((q) => (q.n * lcm) / q.d);
    let g = 0n;
    for (const i of ints) g = bigGcd(g, i);
    if (g === 0n) g = 1n;
    const first = ints.find((i) => i !== 0n) ?? 1n;
    const sgn = first < 0n ? -1n : 1n;
    [a, b, c] = ints.map((i) => num((sgn * i) / g));
  }
  const lhs = plus(times(a, sym("x")), times(b, sym("y")));
  return `${toLatex(lhs)} = ${toLatex(c)}`;
}

function numericLineEquation(l: LineVal): string {
  const a = l.dy;
  const b = -l.dx;
  const c = a * l.px + b * l.py;
  const term = (k: number, v: string, first: boolean): string => {
    if (Math.abs(k) < 1e-12) return "";
    const s = fmt(Math.abs(k));
    return `${k < 0 ? "-" : first ? "" : "+"}${s === "1" ? "" : s}${v}`;
  };
  const lhs = term(a, "x", true) + term(b, "y", Math.abs(a) < 1e-12);
  return `${lhs || "0"} = ${fmt(c)}`;
}

/** LaTeX-Beschreibung eines Objekts (Koordinaten, Gleichung, Maß) oder null. */
export function describe(c: Construction, vals: Values, o: GObject): string | null {
  const v = vals[o.id];
  if (!v) return null;
  const nm = (id: string): string => find(c, id)?.name ?? "?";
  switch (v.t) {
    case "point":
      return v.ex
        ? `${o.name} = \\left(${toLatex(v.ex.x)},\\, ${toLatex(v.ex.y)}\\right)${hasIrrational(v.ex) ? ` \\approx \\left(${fmt(v.x)},\\, ${fmt(v.y)}\\right)` : ""}`
        : `${o.name} \\approx \\left(${fmt(v.x)},\\, ${fmt(v.y)}\\right)`;
    case "line": case "ray":
      return `${o.name}:\\ ${v.ex ? exactLineEquation(v.ex) : numericLineEquation(v)}${v.t === "ray" ? "\\ (\\text{Strahl})" : ""}`;
    case "segment": {
      const d = o.def.k === "segment" ? o.def : null;
      if (!d) return null;
      const len = v.hi;
      if (v.ex) {
        const e = sqrtE(plus(times(v.ex.dx, v.ex.dx), times(v.ex.dy, v.ex.dy)));
        return `\\left|${nm(d.a)}${nm(d.b)}\\right| = ${valueLatex(e, len)}`;
      }
      return `\\left|${nm(d.a)}${nm(d.b)}\\right| ${approxLatex(len)}`;
    }
    case "vector": {
      const d = o.def.k === "vector" ? o.def : null;
      if (!d) return null;
      return v.ex
        ? `\\overrightarrow{${nm(d.a)}${nm(d.b)}} = \\begin{pmatrix}${toLatex(v.ex.dx)}\\\\ ${toLatex(v.ex.dy)}\\end{pmatrix}`
        : `\\overrightarrow{${nm(d.a)}${nm(d.b)}} \\approx \\begin{pmatrix}${fmt(v.dx * v.hi)}\\\\ ${fmt(v.dy * v.hi)}\\end{pmatrix}`;
    }
    case "circle": {
      if (v.ex) {
        // Mittelpunktsform; Terme mit Mittelpunktskoordinate 0 werden zu x² bzw. y²
        const sq = (name: string, c: Expr): Expr => (isZeroE(c) ? pow(sym(name), num(2)) : pow(add(sym(name), neg(c)), num(2)));
        return `${o.name}:\\ ${toLatex(add(sq("x", v.ex.cx), sq("y", v.ex.cy)))} = ${toLatex(v.ex.r2)}`;
      }
      return `${o.name}:\\ \\left(x-${fmt(v.cx)}\\right)^2 + \\left(y-${fmt(v.cy)}\\right)^2 = ${fmt(v.r * v.r)}`;
    }
    case "arc":
      return `${o.name}:\\ r ${approxLatex(v.r)},\\ \\varphi ${approxLatex((v.sweep * 180) / Math.PI)}^\\circ`;
    case "measure":
      return v.latex;
    default:
      return null;
  }
}

const hasIrrational = (p: ExPt): boolean => !(p.x.t === "num" && p.y.t === "num");

