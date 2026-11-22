// Numerische Suche: Nullstellen, Extrema, Polstellen und Grenzwerte im Unendlichen.
import { type Expr, ZERO, num, sym } from "./ast.ts";
import { sMul } from "./simplify.ts";

const fin = Number.isFinite;

function bisect(f: (x: number) => number, a: number, b: number, fa: number): number {
  for (let k = 0; k < 200; k++) {
    const m = (a + b) / 2;
    if (m === a || m === b) break;
    const fm = f(m);
    if (!fin(fm)) {
      // undefinierte Mitte: zur definierten Seite hin weitersuchen
      b = m;
      continue;
    }
    if (fm === 0) return m;
    if (fa * fm < 0) b = m;
    else {
      a = m;
      fa = fm;
    }
  }
  return (a + b) / 2;
}

/** Goldener Schnitt: Extremum (max=true: Maximum) von g auf [a, b]. */
function golden(g: (x: number) => number, a: number, b: number, max: boolean): number {
  const phi = (Math.sqrt(5) - 1) / 2;
  const s = max ? 1 : -1;
  let c = b - phi * (b - a);
  let d = a + phi * (b - a);
  let fc = s * g(c);
  let fd = s * g(d);
  for (let k = 0; k < 120 && b - a > 1e-15 * Math.max(1, Math.abs(a), Math.abs(b)); k++) {
    if (!(fc >= fd) && fin(fd)) {
      a = c; c = d; fc = fd;
      d = a + phi * (b - a);
      fd = s * g(d);
    } else {
      b = d; d = c; fd = fc;
      c = b - phi * (b - a);
      fc = s * g(c);
    }
  }
  return (a + b) / 2;
}

function sample(f: (x: number) => number, a: number, b: number, n: number): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= n; i++) {
    const x = a + ((b - a) * i) / n;
    let y: number;
    try {
      y = f(x);
    } catch {
      y = NaN;
    }
    xs.push(x);
    ys.push(y);
  }
  return { xs, ys };
}

const dedupe = (v: number[]): number[] => {
  const s = v.slice().sort((p, q) => p - q);
  return s.filter((x, i) => i === 0 || Math.abs(x - s[i - 1]) > 1e-9 * (1 + Math.abs(x)));
};

/** Nullstellen von f in [a, b] (Vorzeichenwechsel und berührende Nullstellen; Pole und Sprünge werden verworfen). */
export function scanRoots(f: (x: number) => number, a: number, b: number, n = 4000): number[] {
  const { xs, ys } = sample(f, a, b, n);
  const roots: number[] = [];
  for (let i = 0; i <= n; i++) if (ys[i] === 0) roots.push(xs[i]);
  for (let i = 0; i < n; i++) {
    const yi = ys[i];
    const yj = ys[i + 1];
    if (!fin(yi) || !fin(yj) || !(yi * yj < 0)) continue;
    const r = bisect(f, xs[i], xs[i + 1], yi);
    const fr = f(r);
    if (fin(fr) && Math.abs(fr) <= 1e-7 * Math.max(Math.abs(yi), Math.abs(yj))) roots.push(r);
  }
  for (let i = 1; i < n; i++) {
    const [y0, y1, y2] = [ys[i - 1], ys[i], ys[i + 1]];
    if (!fin(y0) || !fin(y1) || !fin(y2) || y1 === 0) continue;
    if (!(y0 * y2 > 0) || !(Math.abs(y1) < Math.abs(y0) && Math.abs(y1) <= Math.abs(y2))) continue;
    const r = golden((x) => Math.abs(f(x)), xs[i - 1], xs[i + 1], false);
    const fr = Math.abs(f(r));
    if (fr <= 1e-9 * Math.max(1, Math.abs(y0), Math.abs(y2))) roots.push(r);
  }
  return dedupe(roots);
}

export interface NumExtremum {
  x: number;
  y: number;
  type: "max" | "min";
}

/** Lokale Extrema in (a, b); optional mit Ableitung zur Nachschärfung. */
export function scanExtrema(f: (x: number) => number, a: number, b: number, df?: (x: number) => number, n = 4000): NumExtremum[] {
  const { xs, ys } = sample(f, a, b, n);
  const out: NumExtremum[] = [];
  const h = (b - a) / n;
  for (let i = 1; i < n; i++) {
    const [y0, y1, y2] = [ys[i - 1], ys[i], ys[i + 1]];
    if (!fin(y0) || !fin(y1) || !fin(y2)) continue;
    const isMax = y1 > y0 && y1 >= y2;
    const isMin = y1 < y0 && y1 <= y2;
    if (!isMax && !isMin) continue;
    let x = golden(f, xs[i - 1], xs[i + 1], isMax);
    if (df) {
      const d0 = df(x - h);
      const d1 = df(x + h);
      if (fin(d0) && fin(d1) && d0 * d1 < 0) x = bisect(df, x - h, x + h, d0);
    }
    const y = f(x);
    if (!fin(y) || Math.abs(y) > 100 * (1 + Math.max(Math.abs(y0), Math.abs(y1), Math.abs(y2)))) continue;
    if (isMax ? y < Math.max(y0, y1, y2) - 1e-9 * (1 + Math.abs(y)) : y > Math.min(y0, y1, y2) + 1e-9 * (1 + Math.abs(y))) continue;
    out.push({ x, y, type: isMax ? "max" : "min" });
  }
  return out.filter((e, i) => i === 0 || Math.abs(e.x - out[i - 1].x) > 1e-7 * (1 + Math.abs(e.x)) || e.type !== out[i - 1].type);
}

/** Wächst |f| bei Annäherung an c (mindestens von einer Seite) über alle Grenzen? */
function isPole(f: (x: number) => number, c: number): boolean {
  const s = Math.max(1, Math.abs(c));
  for (const side of [-1, 1]) {
    const vals: number[] = [];
    for (const d of [1e-3, 1e-5, 1e-7]) {
      let y: number;
      try {
        y = f(c + side * d * s);
      } catch {
        y = NaN;
      }
      if (!fin(y)) break;
      vals.push(Math.abs(y));
    }
    if (vals.length === 3 && vals[1] > 1.2 * vals[0] && vals[2] > 1.2 * vals[1] && vals[2] >= 10) return true;
  }
  return false;
}

/** Senkrechte Asymptoten (Polstellen) in [a, b]. */
export function findPoles(f: (x: number) => number, a: number, b: number, n = 4000): number[] {
  const { xs, ys } = sample(f, a, b, n);
  const cand: number[] = [];
  for (let i = 0; i < n; i++) {
    const yi = ys[i];
    const yj = ys[i + 1];
    if (fin(yi) && fin(yj) && yi * yj < 0) cand.push(bisect(f, xs[i], xs[i + 1], yi));
    // Rand des Definitionsbereichs
    if (fin(yi) && !fin(yj) && !Number.isNaN(yj) === false) {
      let lo = xs[i];
      let hi = xs[i + 1];
      for (let k = 0; k < 60; k++) {
        const m = (lo + hi) / 2;
        if (fin(f(m))) lo = m;
        else hi = m;
      }
      cand.push(lo);
    }
    if (!fin(yi) && fin(yj)) {
      let lo = xs[i];
      let hi = xs[i + 1];
      for (let k = 0; k < 60; k++) {
        const m = (lo + hi) / 2;
        if (fin(f(m))) hi = m;
        else lo = m;
      }
      cand.push(hi);
    }
  }
  for (let i = 1; i < n; i++) {
    const [y0, y1, y2] = [ys[i - 1], ys[i], ys[i + 1]];
    if (!fin(y0) || !fin(y1) || !fin(y2)) continue;
    if (Math.abs(y1) > 20 && Math.abs(y1) > Math.abs(y0) && Math.abs(y1) >= Math.abs(y2)) {
      cand.push(golden((x) => (fin(f(x)) ? Math.abs(f(x)) : 1e300), xs[i - 1], xs[i + 1], true));
    }
  }
  return dedupe(cand).filter((c) => isPole(f, c));
}

// ---------- Erkennen „schöner“ Zahlen ----------
function bestRational(x: number, maxQ: number, tol: number): [bigint, bigint] | null {
  let h1 = 1, h0 = 0, k1 = 0, k0 = 1;
  let y = x;
  for (let i = 0; i < 30; i++) {
    const a = Math.floor(y);
    [h1, h0] = [a * h1 + h0, h1];
    [k1, k0] = [a * k1 + k0, k1];
    if (k1 > maxQ) return null;
    if (Math.abs(x - h1 / k1) <= tol) return [BigInt(h1), BigInt(k1)];
    const fr = y - a;
    if (fr < 1e-12) return null;
    y = 1 / fr;
  }
  return null;
}

/** Vermutet einen Ausdruck (rational oder rationales Vielfaches von π) für einen Näherungswert – nur eine Vermutung. */
export function recognize(x: number): Expr | null {
  if (!fin(x)) return null;
  if (Math.abs(x) < 1e-5) return ZERO;
  // π-Vielfache zuerst, sonst werden z. B. π/2 als 355/226 „erkannt“
  const p = bestRational(x / Math.PI, 12, 1e-8 * (1 + Math.abs(x / Math.PI)));
  if (p) return sMul([num(p[0], p[1]), sym("pi")]);
  const r = bestRational(x, 1000, 1e-7 * (1 + Math.abs(x)));
  if (r) return num(r[0], r[1]);
  return null;
}

export type EndBehavior =
  | { kind: "horizontal"; y: number }
  | { kind: "slant"; m: number; b: number }
  | { kind: "divergent" };

/** Verhalten für x → +∞ (side = 1) bzw. x → −∞ (side = −1). */
export function endBehavior(f: (x: number) => number, side: 1 | -1): EndBehavior {
  const g = (x: number): number => {
    try {
      return f(x);
    } catch {
      return NaN;
    }
  };
  const X1 = side * 1e6;
  const X2 = side * 1e8;
  const v1 = g(X1);
  const v2 = g(X2);
  if (!fin(v1) || !fin(v2)) return { kind: "divergent" };
  // Abstand 100×: Reste ∝ 1/x lassen sich so wegextrapolieren
  if (Math.abs(v2 - v1) <= 1e-4 * (1 + Math.abs(v2))) return { kind: "horizontal", y: (100 * v2 - v1) / 99 };
  const m1 = v1 / X1;
  const m2 = v2 / X2;
  if (Math.abs(m2 - m1) <= 1e-4 * (1 + Math.abs(m2)) && Math.abs(m2) > 1e-6) {
    const rec = recognize(m2);
    let m = m2;
    if (rec && rec.t === "num") m = Number(rec.n) / Number(rec.d);
    const b1 = g(side * 1e5) - m * side * 1e5;
    const b2 = g(side * 1e6) - m * side * 1e6;
    if (fin(b1) && fin(b2) && Math.abs(b2 - b1) <= 1e-3 * (1 + Math.abs(b2))) return { kind: "slant", m, b: (10 * b2 - b1) / 9 };
  }
  return { kind: "divergent" };
}
