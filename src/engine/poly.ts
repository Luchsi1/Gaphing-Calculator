// Exakte Polynome mit rationalen Koeffizienten: Zerlegung, Division, Nullstellen, rationale Funktionen.
import { type Expr, type NumE, ZERO, ONE, NEG1, num, sym, add, mul, pow, fn, EngineError } from "./ast.ts";
import { simplify, expand, sMul, sAdd, sPow } from "./simplify.ts";
import { evalNumber } from "./eval.ts";

export type Rat = { n: bigint; d: bigint };

const gcdB = (a: bigint, b: bigint): bigint => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
};
export const rat = (n: bigint, d: bigint = 1n): Rat => {
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcdB(n, d);
  return g > 1n ? { n: n / g, d: d / g } : { n, d };
};
export const rAdd = (a: Rat, b: Rat): Rat => rat(a.n * b.d + b.n * a.d, a.d * b.d);
export const rSub = (a: Rat, b: Rat): Rat => rat(a.n * b.d - b.n * a.d, a.d * b.d);
export const rMul = (a: Rat, b: Rat): Rat => rat(a.n * b.n, a.d * b.d);
export const rDiv = (a: Rat, b: Rat): Rat => rat(a.n * b.d, a.d * b.n);
export const rNeg = (a: Rat): Rat => ({ n: -a.n, d: a.d });
export const rIsZero = (a: Rat): boolean => a.n === 0n;
export const rEq = (a: Rat, b: Rat): boolean => a.n === b.n && a.d === b.d;
export const rNum = (a: Rat): number => Number(a.n) / Number(a.d);
export const rExpr = (a: Rat): NumE => ({ t: "num", n: a.n, d: a.d });
const R0 = rat(0n);

// ---------- Polynome (Index = Grad) ----------
export const polyTrim = (c: Rat[]): Rat[] => {
  let n = c.length;
  while (n > 1 && rIsZero(c[n - 1])) n--;
  return n === 0 ? [R0] : c.slice(0, n);
};
export const polyDeg = (c: Rat[]): number => polyTrim(c).length - 1;
export const polyIsZero = (c: Rat[]): boolean => polyTrim(c).every(rIsZero);

export function polyMul(a: Rat[], b: Rat[]): Rat[] {
  const out: Rat[] = Array.from({ length: a.length + b.length - 1 }, () => R0);
  a.forEach((x, i) => b.forEach((y, j) => (out[i + j] = rAdd(out[i + j], rMul(x, y)))));
  return polyTrim(out);
}
export function polySub(a: Rat[], b: Rat[]): Rat[] {
  const n = Math.max(a.length, b.length);
  return polyTrim(Array.from({ length: n }, (_, i) => rSub(a[i] ?? R0, b[i] ?? R0)));
}
export const polyDeriv = (c: Rat[]): Rat[] =>
  c.length <= 1 ? [R0] : polyTrim(c.slice(1).map((x, i) => rMul(x, rat(BigInt(i + 1)))));

export function polyDivMod(a0: Rat[], b0: Rat[]): { q: Rat[]; r: Rat[] } {
  const a = polyTrim(a0);
  const b = polyTrim(b0);
  if (polyIsZero(b)) throw new EngineError("Division durch das Nullpolynom");
  const q: Rat[] = Array.from({ length: Math.max(1, a.length - b.length + 1) }, () => R0);
  let r = a.slice();
  const lb = b[b.length - 1];
  while (r.length >= b.length && !polyIsZero(r)) {
    const k = r.length - b.length;
    const f = rDiv(r[r.length - 1], lb);
    q[k] = f;
    r = polyTrim(polySub(r, [...Array.from({ length: k }, () => R0), ...b.map((x) => rMul(x, f))]));
    if (r.length < b.length) break;
  }
  return { q: polyTrim(q), r: polyTrim(r) };
}

export const polyEvalNum = (c: number[], x: number): number => c.reduceRight((acc, k) => acc * x + k, 0);

export function polyToExpr(c: Rat[], v: string): Expr {
  const terms: Expr[] = [];
  c.forEach((k, i) => {
    if (rIsZero(k)) return;
    terms.push(i === 0 ? rExpr(k) : sMul([rExpr(k), i === 1 ? sym(v) : pow(sym(v), num(i))]));
  });
  return terms.length ? sAdd(terms) : ZERO;
}

/** Ausdruck als Polynom in v mit rationalen Koeffizienten, sonst null. */
export function toPolynomial(e0: Expr, v: string): Rat[] | null {
  let e: Expr;
  try {
    e = expand(e0);
  } catch {
    return null;
  }
  const terms = e.t === "add" ? e.args : [e];
  const coeffs: Rat[] = [];
  for (const t of terms) {
    let coeff: Rat = rat(1n);
    let deg = 0;
    const factors = t.t === "mul" ? t.args : [t];
    for (const f of factors) {
      if (f.t === "num") coeff = rMul(coeff, f);
      else if (f.t === "sym" && f.name === v) deg += 1;
      else if (f.t === "pow" && f.base.t === "sym" && f.base.name === v && f.exp.t === "num" && f.exp.d === 1n && f.exp.n >= 0n && f.exp.n <= 200n) deg += Number(f.exp.n);
      else return null;
    }
    while (coeffs.length <= deg) coeffs.push(R0);
    coeffs[deg] = rAdd(coeffs[deg], coeff);
  }
  return polyTrim(coeffs.length ? coeffs : [R0]);
}

// ---------- rationale Funktionen ----------
function nd(e: Expr): [Expr, Expr] | null {
  switch (e.t) {
    case "num":
    case "sym":
      return [e, ONE];
    case "mul": {
      const parts = e.args.map(nd);
      if (parts.some((p) => !p)) return null;
      return [mul(...parts.map((p) => (p as [Expr, Expr])[0])), mul(...parts.map((p) => (p as [Expr, Expr])[1]))];
    }
    case "add": {
      const parts = e.args.map(nd);
      if (parts.some((p) => !p)) return null;
      const ps = parts as [Expr, Expr][];
      const D = ps.map((p) => p[1]);
      const N = ps.map((p, i) => mul(p[0], ...D.filter((_, j) => j !== i)));
      return [add(...N), mul(...D)];
    }
    case "pow": {
      if (e.exp.t !== "num" || e.exp.d !== 1n || e.exp.n > 60n || e.exp.n < -60n) return null;
      const b = nd(e.base);
      if (!b) return null;
      const k = e.exp.n < 0n ? -e.exp.n : e.exp.n;
      const N = pow(b[0], num(k));
      const D = pow(b[1], num(k));
      return e.exp.n >= 0n ? [N, D] : [D, N];
    }
    default:
      return null;
  }
}

/** f = P/Q mit Polynomen P, Q in v (rationale Koeffizienten), sonst null. */
export function rationalForm(e: Expr, v: string, simplifyFirst = true): { P: Rat[]; Q: Rat[] } | null {
  // simplifyFirst = false: Nenner bleiben erhalten (x²/x ist bei x = 0 nicht definiert, obwohl es sich zu x kürzt)
  const r = nd(simplifyFirst ? simplify(e) : e);
  if (!r) return null;
  const P = toPolynomial(r[0], v);
  const Q = toPolynomial(r[1], v);
  if (!P || !Q || polyIsZero(Q)) return null;
  return { P, Q };
}

// ---------- Nullstellen ----------
function divisors(n: bigint): bigint[] | null {
  if (n < 0n) n = -n;
  if (n === 0n || n > 1_000_000_000_000n) return null;
  const x = Number(n);
  const out: bigint[] = [];
  for (let i = 1; i * i <= x; i++) {
    if (x % i === 0) {
      out.push(BigInt(i));
      if (i * i !== x) out.push(BigInt(x / i));
    }
  }
  return out;
}

function toIntegerCoeffs(c: Rat[]): bigint[] {
  let l = 1n;
  for (const k of c) l = (l / gcdB(l, k.d)) * k.d;
  const ints = c.map((k) => (k.n * l) / k.d);
  let g = 0n;
  for (const k of ints) g = gcdB(g, k);
  return g > 1n ? ints.map((k) => k / g) : ints;
}

function deflate(c: Rat[], r: Rat): Rat[] {
  const n = c.length - 1;
  const b: Rat[] = Array.from({ length: n }, () => R0);
  let carry = c[n];
  for (let k = n - 1; k >= 0; k--) {
    b[k] = carry;
    carry = rAdd(c[k], rMul(r, carry));
  }
  return b;
}

/** Alle rationalen Nullstellen (mit Vielfachheit) und der nicht weiter zerlegbare Rest. */
export function rationalRoots(coeffs: Rat[]): { roots: Rat[]; rest: Rat[] } {
  let cur = polyTrim(coeffs);
  const roots: Rat[] = [];
  while (cur.length > 1 && rIsZero(cur[0])) {
    roots.push(R0);
    cur = cur.slice(1);
  }
  while (cur.length > 1) {
    const ints = toIntegerCoeffs(cur);
    const dp = divisors(ints[0]);
    const dq = divisors(ints[ints.length - 1]);
    if (!dp || !dq || dp.length * dq.length > 40000) break;
    let found: Rat | null = null;
    outer: for (const p of dp) {
      for (const q of dq) {
        if (gcdB(p, q) !== 1n) continue;
        for (const s of [1n, -1n]) {
          const x = rat(s * p, q);
          let acc = 0n;
          const n = ints.length - 1;
          for (let i = 0; i <= n; i++) acc += ints[i] * x.n ** BigInt(i) * x.d ** BigInt(n - i);
          if (acc === 0n) {
            found = x;
            break outer;
          }
        }
      }
    }
    if (!found) break;
    roots.push(found);
    cur = deflate(cur, found);
  }
  return { roots, rest: cur };
}

/** Reelle Nullstellen eines Polynoms mit Gleitkommakoeffizienten (aufsteigend). */
export function realRootsNumeric(c0: number[]): number[] {
  const c = c0.slice();
  while (c.length > 1 && c[c.length - 1] === 0) c.pop();
  const deg = c.length - 1;
  if (deg <= 0) return [];
  if (deg === 1) return [-c[0] / c[1]];
  const B = 1 + Math.max(...c.slice(0, -1).map((x) => Math.abs(x / c[deg])));
  const dc = c.slice(1).map((x, i) => x * (i + 1));
  const crit = realRootsNumeric(dc).filter((x) => x > -B && x < B);
  const pts = [-B, ...crit, B];
  const scale = Math.max(...c.map(Math.abs));
  const tol = (x: number): number => 1e-11 * scale * Math.max(1, Math.abs(x) ** deg);
  const roots: number[] = [];
  for (const x of crit) if (Math.abs(polyEvalNum(c, x)) <= tol(x)) roots.push(x);
  for (let i = 0; i + 1 < pts.length; i++) {
    let a = pts[i];
    let b = pts[i + 1];
    let fa = polyEvalNum(c, a);
    const fb = polyEvalNum(c, b);
    if (!(fa * fb < 0)) continue;
    for (let k = 0; k < 200; k++) {
      const m = (a + b) / 2;
      const fm = polyEvalNum(c, m);
      if (fm === 0) { a = b = m; break; }
      if (fa * fm < 0) b = m;
      else { a = m; fa = fm; }
    }
    roots.push((a + b) / 2);
  }
  roots.sort((p, q) => p - q);
  return roots.filter((x, i) => i === 0 || Math.abs(x - roots[i - 1]) > 1e-9 * (1 + Math.abs(x)));
}

/** √r für eine rationale Zahl r > 0 als vereinfachter Ausdruck (z. B. √(8/9) = 2√2/3). */
export function sqrtRat(r: Rat): Expr {
  return simplify(sMul([rExpr(rat(1n, r.d)), sPow(num(r.n * r.d), num(1, 2))]));
}

export interface RealRoot {
  value: number;
  /** exakter Ausdruck, falls bestimmbar (rational oder Wurzelausdruck), sonst null */
  expr: Expr | null;
  mult: number;
}

function rootOf(e: Expr, mult = 1): RealRoot | null {
  try {
    const v = evalNumber(e);
    return Number.isFinite(v) ? { value: v, expr: e, mult } : null;
  } catch {
    return null;
  }
}

/** Kubische Gleichung ohne rationale Nullstelle: Cardano (eine reelle Wurzel) bzw. trigonometrische Form (drei reelle Wurzeln). */
function solveCubic(c: Rat[]): RealRoot[] {
  const [d, cc, b, a] = [c[0], c[1], c[2], c[3]];
  const three = rat(3n);
  const p = rDiv(rSub(rMul(three, rMul(a, cc)), rMul(b, b)), rMul(three, rMul(a, a)));
  const q = rDiv(
    rAdd(rSub(rMul(rat(2n), rMul(b, rMul(b, b))), rMul(rat(9n), rMul(a, rMul(b, cc)))), rMul(rat(27n), rMul(rMul(a, a), d))),
    rMul(rat(27n), rMul(a, rMul(a, a)))
  );
  const shift = rExpr(rNeg(rDiv(b, rMul(three, a)))); // x = t − b/(3a)
  const disc = rAdd(rDiv(rMul(q, q), rat(4n)), rDiv(rMul(p, rMul(p, p)), rat(27n))); // q²/4 + p³/27
  const out: RealRoot[] = [];
  if (disc.n > 0n) {
    const sd = sqrtRat(disc);
    const half = rExpr(rNeg(rDiv(q, rat(2n))));
    const u = add(half, sd);
    const w = add(half, sMul([NEG1, sd]));
    const r = rootOf(expand(add(pow(u, num(1, 3)), pow(w, num(1, 3)), shift)));
    if (r) out.push(r);
  } else if (disc.n < 0n) {
    const m = sMul([num(2), sqrtRat(rDiv(rNeg(p), three))]);
    const arg = sMul([rExpr(rDiv(rMul(three, q), rMul(rat(2n), p))), sqrtRat(rDiv(rNeg(three), p))]);
    for (let k = 0; k < 3; k++) {
      const angle = add(sMul([num(1, 3), fn("arccos", arg)]), sMul([num(-2 * k, 3), sym("pi")]));
      const r = rootOf(add(sMul([m, fn("cos", angle)]), shift));
      if (r) out.push(r);
    }
  }
  return out;
}

/** Höhere Grade ohne rationale Nullstelle: x^n = c (n-te Wurzel) und Polynome in x² (Substitution y = x²). */
function solveHigher(c: Rat[]): RealRoot[] | null {
  const n = c.length - 1;
  const lead = c[n];
  const middleZero = c.slice(1, n).every(rIsZero);
  if (middleZero) {
    const r = rDiv(rNeg(c[0]), lead); // x^n = r
    const sgn = r.n < 0n ? -1 : 1;
    const mag = rExpr(sgn < 0 ? rNeg(r) : r);
    if (n % 2 === 0) {
      if (sgn < 0) return [];
      const base = simplify(pow(mag, num(1, n)));
      return [rootOf(simplify(sMul([NEG1, base])))!, rootOf(base)!].filter(Boolean).sort((p, q) => p.value - q.value);
    }
    const root = simplify(sMul([num(sgn), pow(mag, num(1, n))]));
    const rr = rootOf(root);
    return rr ? [rr] : null;
  }
  const oddZero = c.every((k, i) => i % 2 === 0 || rIsZero(k));
  if (oddZero && n >= 4) {
    const red = c.filter((_, i) => i % 2 === 0); // Koeffizienten in y = x²
    const ys = solvePolynomial(red).roots;
    const out: RealRoot[] = [];
    for (const y of ys) {
      if (y.value <= 0) continue;
      if (y.expr) {
        const sq = simplify(pow(y.expr, num(1, 2)));
        for (const e of [sq, simplify(sMul([NEG1, sq]))]) {
          const r = rootOf(e, y.mult);
          if (r) out.push(r);
        }
      } else {
        const sv = Math.sqrt(y.value);
        out.push({ value: -sv, expr: null, mult: y.mult }, { value: sv, expr: null, mult: y.mult });
      }
    }
    return out;
  }
  return null;
}

/** Reelle Nullstellen eines Polynoms: rational, quadratisch, kubisch (Cardano), x^n = c und Polynome in x² exakt, Rest numerisch. */
export function solvePolynomial(coeffs: Rat[]): { all: boolean; roots: RealRoot[] } {
  const c = polyTrim(coeffs);
  if (c.length === 1) return { all: rIsZero(c[0]), roots: [] };
  const { roots: rr, rest } = rationalRoots(c);
  const out: RealRoot[] = [];
  for (const r of rr) {
    const hit = out.find((o) => o.expr && o.expr.t === "num" && o.expr.n === r.n && o.expr.d === r.d);
    if (hit) hit.mult++;
    else out.push({ value: rNum(r), expr: rExpr(r), mult: 1 });
  }
  if (rest.length === 3) {
    const [c0, b, a] = [rest[0], rest[1], rest[2]];
    const D = rSub(rMul(b, b), rMul(rat(4n), rMul(a, c0)));
    if (D.n > 0n) {
      const sd = simplify(sMul([rExpr(rat(1n, D.d)), sPow(num(D.n * D.d), num(1, 2))]));
      const inv2a = rExpr(rDiv(rat(1n), rMul(rat(2n), a)));
      for (const sgn of [1, -1]) {
        const e = expand(mul(add(rExpr(rNeg(b)), sgn === 1 ? sd : sMul([NEG1, sd])), inv2a));
        out.push({ value: evalNumber(e), expr: e, mult: 1 });
      }
    }
  } else if (rest.length === 4) {
    const cub = solveCubic(rest);
    if (cub.length) out.push(...cub);
    else for (const x of realRootsNumeric(rest.map(rNum))) out.push({ value: x, expr: null, mult: 1 });
  } else if (rest.length > 4) {
    const hi = solveHigher(rest);
    if (hi) out.push(...hi);
    else for (const x of realRootsNumeric(rest.map(rNum))) out.push({ value: x, expr: null, mult: 1 });
  }
  out.sort((p, q) => p.value - q.value);
  return { all: false, roots: out };
}

/** Gauß-Jordan über ℚ: A x = b. */
export function solveLinearRat(
  A: Rat[][],
  b: Rat[]
): { kind: "unique"; x: Rat[] } | { kind: "none" } | { kind: "infinite"; rank: number } {
  const m = A.length;
  const n = A[0]?.length ?? 0;
  const M = A.map((row, i) => [...row, b[i]]);
  let r = 0;
  const pivCols: number[] = [];
  for (let c = 0; c < n && r < m; c++) {
    let p = r;
    while (p < m && rIsZero(M[p][c])) p++;
    if (p === m) continue;
    [M[r], M[p]] = [M[p], M[r]];
    const inv = rDiv(rat(1n), M[r][c]);
    M[r] = M[r].map((x) => rMul(x, inv));
    for (let i = 0; i < m; i++) {
      if (i !== r && !rIsZero(M[i][c])) {
        const f = M[i][c];
        M[i] = M[i].map((x, j) => rSub(x, rMul(f, M[r][j])));
      }
    }
    pivCols.push(c);
    r++;
  }
  for (let i = r; i < m; i++) if (!rIsZero(M[i][n])) return { kind: "none" };
  if (r < n) return { kind: "infinite", rank: r };
  const x: Rat[] = Array.from({ length: n }, () => R0);
  pivCols.forEach((c, i) => (x[c] = M[i][n]));
  return { kind: "unique", x };
}
