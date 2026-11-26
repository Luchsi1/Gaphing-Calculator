// Symbolische Integration „wo möglich“: Regeltabelle, lineare Substitution, u-Substitution,
// partielle Integration, Partialbrüche. Jede gefundene Stammfunktion wird durch Ableiten gegengeprüft.
import {
  type Expr, ZERO, ONE, NEG1, num, sym, add, mul, pow, fn, key, mapChildren, subst, freeSymbols,
} from "./ast.ts";
import { simplify, sAdd, sMul, sPow, neg, expand } from "./simplify.ts";
import { derivative } from "./diff.ts";
import { compile, integrate as integrateNum } from "./eval.ts";
import { findPoles } from "./roots.ts";
import {
  type Rat, rat, rAdd, rMul, rDiv, rSub, rNeg, rExpr, rIsZero, polyDivMod, polyDeriv, polyDeg, polyMul, polyIsZero,
  rationalForm, rationalRoots, solveLinearRat, toPolynomial, polyToExpr, sqrtRat,
} from "./poly.ts";

const dep = (e: Expr, v: string): boolean => freeSymbols(e).has(v);
const isZero = (e: Expr): boolean => e.t === "num" && e.n === 0n;
const div = (a: Expr, b: Expr): Expr => sMul([a, sPow(b, NEG1)]);
const LN = (x: Expr): Expr => fn("ln", fn("abs", x));

function deriv(e: Expr, v: string): Expr | null {
  try {
    return derivative(e, v);
  } catch {
    return null;
  }
}

/** u = a·v + b mit v-freien a ≠ 0, b. */
function linearIn(u: Expr, v: string): { a: Expr; b: Expr } | null {
  if (!dep(u, v)) return null;
  const a = deriv(u, v);
  if (!a || dep(a, v) || isZero(a)) return null;
  const b = simplify(subst(u, { [v]: ZERO }));
  const resid = simplify(add(u, mul(NEG1, a, sym(v)), mul(NEG1, b)));
  return isZero(resid) ? { a, b } : null;
}

function replaceSub(e: Expr, target: Expr, repl: Expr): Expr {
  if (key(e) === key(target)) return repl;
  return mapChildren(e, (c) => replaceSub(c, target, repl));
}

function candidates(e: Expr, v: string): Expr[] {
  const seen = new Map<string, Expr>();
  const walk = (x: Expr): void => {
    if (x.t === "fn") {
      x.args.forEach((a) => dep(a, v) && a.t !== "sym" && seen.set(key(a), a));
      if (dep(x, v)) seen.set(key(x), x);
    }
    if (x.t === "pow") {
      if (dep(x.base, v) && x.base.t !== "sym") seen.set(key(x.base), x.base);
      if (dep(x.exp, v) && x.exp.t !== "sym") seen.set(key(x.exp), x.exp);
    }
    mapChildren(x, (c) => (walk(c), c));
  };
  walk(e);
  return [...seen.values()].sort((p, q) => key(p).length - key(q).length);
}

function uSub(e: Expr, v: string, depth: number): Expr | null {
  if (depth > 2) return null;
  const w = "_u";
  for (const u of candidates(e, v).slice(0, 14)) {
    const du = deriv(u, v);
    if (!du || isZero(du)) continue;
    const q = simplify(mul(e, pow(du, NEG1)));
    const qw = replaceSub(q, u, sym(w));
    if (dep(qw, v)) continue;
    const G = integ(qw, w, depth + 1);
    if (G) return subst(G, { [w]: u });
  }
  return null;
}

// ---------- Partialbruchzerlegung ----------

function integRational(P: Rat[], Q: Rat[], v: string): Expr | null {
  const { q, r } = polyDivMod(P, Q);
  const parts: Expr[] = [];
  q.forEach((c, k) => {
    if (!rIsZero(c)) parts.push(sMul([rExpr(rDiv(c, rat(BigInt(k + 1)))), pow(sym(v), num(k + 1))]));
  });
  if (!polyIsZero(r)) {
    const { roots, rest } = rationalRoots(Q);
    const restDeg = polyDeg(rest);
    if (restDeg > 2) return null;
    let quad: Rat[] | null = null;
    let lc = rest[rest.length - 1];
    if (restDeg === 2) {
      quad = rest;
    }
    // Faktoren (x − r)^m
    const distinct: { root: Rat; m: number }[] = [];
    for (const x of roots) {
      const h = distinct.find((d) => d.root.n === x.n && d.root.d === x.d);
      if (h) h.m++;
      else distinct.push({ root: x, m: 1 });
    }
    // Unbekannte: A_{i,j} (j=1..m_i) und ggf. (A x + B)
    const total = roots.length + (quad ? 2 : 0);
    const lin = (root: Rat): Rat[] => [rNeg(root), rat(1n)];
    const full: Rat[] = (() => {
      let p: Rat[] = [lc];
      for (const x of roots) p = polyMul(p, lin(x));
      return quad ? polyMul(p.slice(0, 1).length ? [rat(1n)] : p, quad) : p;
    })();
    void full;
    // Basispolynome: Qm / (x−r)^j  (Qm = ∏(x−r_i)^m_i · (quad oder 1)), lc wird am Ende berücksichtigt
    const monic = (): Rat[] => {
      let p: Rat[] = [rat(1n)];
      for (const x of roots) p = polyMul(p, lin(x));
      return p;
    };
    const quadMonicBase = quad ? quad : [rat(1n)];
    const basis: Rat[][] = [];
    const labels: { type: "lin"; root: Rat; j: number }[] | any[] = [];
    for (const d of distinct) {
      for (let j = 1; j <= d.m; j++) {
        let p: Rat[] = [rat(1n)];
        for (const o of distinct) {
          const mm = o === d ? o.m - j : o.m;
          for (let k = 0; k < mm; k++) p = polyMul(p, lin(o.root));
        }
        p = polyMul(p, quadMonicBase);
        basis.push(p);
        (labels as any[]).push({ type: "lin", root: d.root, j });
      }
    }
    if (quad) {
      const base = monic();
      basis.push(polyMul(base, [rat(0n), rat(1n)]), base);
      (labels as any[]).push({ type: "qx" }, { type: "q1" });
    }
    // lc ist in quad bzw. (bei reiner Linearzerlegung) separat: Q = lc·∏… ⇒ r/Q = (r/lc)/∏…
    const rScaled = quad ? r : r.map((c) => rDiv(c, lc));
    const rows = Math.max(total, rScaled.length, ...basis.map((b) => b.length));
    const A: Rat[][] = Array.from({ length: rows }, (_, i) => basis.map((b) => b[i] ?? rat(0n)));
    const b: Rat[] = Array.from({ length: rows }, (_, i) => rScaled[i] ?? rat(0n));
    const sol = solveLinearRat(A, b);
    if (sol.kind !== "unique") return null;
    let qa = rat(0n);
    let qb = rat(0n);
    (labels as any[]).forEach((lab, i) => {
      const c = sol.x[i];
      if (lab.type === "qx") qa = c;
      else if (lab.type === "q1") qb = c;
      else if (!rIsZero(c)) {
        const base = polyToExpr([rNeg(lab.root), rat(1n)], v);
        if (lab.j === 1) parts.push(sMul([rExpr(c), LN(base)]));
        else parts.push(sMul([rExpr(rDiv(c, rat(BigInt(1 - lab.j)))), sPow(base, num(1 - lab.j))]));
      }
    });
    if (quad) {
      const [c0, b1, a2] = [quad[0], quad[1], quad[2]];
      const two_a = rMul(rat(2n), a2);
      const disc = rSub(rMul(rat(4n), rMul(a2, c0)), rMul(b1, b1));
      // irreduzibel (disc > 0): Q hat festes Vorzeichen; mit reellen Nullstellen braucht ln einen Betrag
      const lnQ = disc.n > 0n ? fn("ln", polyToExpr(quad, v)) : fn("ln", fn("abs", polyToExpr(quad, v)));
      if (!rIsZero(qa)) parts.push(sMul([rExpr(rDiv(qa, two_a)), lnQ]));
      const kk = rSub(qb, rDiv(rMul(qa, b1), two_a));
      if (!rIsZero(kk)) {
        const lin2 = add(sMul([rExpr(two_a), sym(v)]), rExpr(b1));
        if (disc.n > 0n) {
          const s = sqrtRat(disc);
          parts.push(sMul([rExpr(kk), num(2), sPow(s, NEG1), fn("arctan", sMul([lin2, sPow(s, NEG1)]))]));
        } else {
          // zwei irrationale reelle Nullstellen: ∫ 1/R = (1/√D)·ln|(2Av + B − √D)/(2Av + B + √D)|
          // durch 2A gekürzt: ((v + B/2A) − √D/2A) / ((v + B/2A) + √D/2A)
          const s = sqrtRat(rNeg(disc));
          const sh = add(sym(v), rExpr(rDiv(b1, two_a)));
          const sd = sMul([s, rExpr(rDiv(rat(1n), two_a))]);
          const ratio = sMul([add(sh, neg(sd)), sPow(add(sh, sd), NEG1)]);
          void lin2;
          parts.push(sMul([rExpr(kk), sPow(s, NEG1), fn("ln", fn("abs", ratio))]));
        }
      }
    }
    lc = lc;
  }
  return sAdd(parts);
}

// ---------- Potenzen von Winkelfunktionen (Reduktionsformeln) ----------
type Trig = (n: number, u: Expr, a: Expr, x: Expr) => Expr;
const sinPow: Trig = (n, u, a, x) =>
  n === 0 ? x : n === 1 ? div(neg(fn("cos", u)), a)
  : sAdd([div(neg(mul(pow(fn("sin", u), num(n - 1)), fn("cos", u))), mul(num(n), a)), sMul([num(n - 1, n), sinPow(n - 2, u, a, x)])]);
const cosPow: Trig = (n, u, a, x) =>
  n === 0 ? x : n === 1 ? div(fn("sin", u), a)
  : sAdd([div(mul(pow(fn("cos", u), num(n - 1)), fn("sin", u)), mul(num(n), a)), sMul([num(n - 1, n), cosPow(n - 2, u, a, x)])]);
const tanPow: Trig = (n, u, a, x) =>
  n === 0 ? x : n === 1 ? div(neg(LN(fn("cos", u))), a)
  : sAdd([div(pow(fn("tan", u), num(n - 1)), mul(num(n - 1), a)), neg(tanPow(n - 2, u, a, x))]);
const secPow: Trig = (n, u, a, x) =>
  n === 1 ? div(LN(add(pow(fn("cos", u), NEG1), fn("tan", u))), a)
  : n === 2 ? div(fn("tan", u), a)
  : sAdd([div(mul(pow(fn("cos", u), num(2 - n)), fn("tan", u)), mul(num(n - 1), a)), sMul([num(n - 2, n - 1), secPow(n - 2, u, a, x)])]);
const cscPow: Trig = (n, u, a, x) =>
  n === 1 ? div(fn("ln", fn("abs", fn("tan", div(u, num(2))))), a)
  : n === 2 ? div(neg(fn("cot", u)), a)
  : sAdd([div(neg(mul(pow(fn("sin", u), num(2 - n)), fn("cot", u))), mul(num(n - 1), a)), sMul([num(n - 2, n - 1), cscPow(n - 2, u, a, x)])]);

/** ∫ ln^n(u) dv mit u = a·v + b: (1/a)·G_n(u), G_n = u·ln^n u − n·G_{n−1}. */
function lnPow(n: number, u: Expr): Expr {
  if (n === 0) return u;
  return sAdd([mul(u, pow(fn("ln", u), num(n))), neg(sMul([num(n), lnPow(n - 1, u)]))]);
}

/** Polynom in w (Koeffizienten als Rat) -> ∫ ... dw als Ausdruck in w. */
function integratePolyIn(coeffs: Rat[], w: Expr): Expr {
  return sAdd(coeffs.map((c, j) => (rIsZero(c) ? ZERO : sMul([rExpr(rDiv(c, rat(BigInt(j + 1)))), pow(w, num(j + 1))]))));
}

/** sin^m(u)·cos^n(u) mit ganzzahligen m, n ≥ 0 und linearem u. */
function sinCosProduct(m: number, n: number, u: Expr, a: Expr, v: string): Expr | null {
  if (m + n > 14) return null;
  const W = sym("_w");
  const polyExpr = (e: Expr): Rat[] | null => toPolynomial(e, "_w");
  if (m % 2 === 1) {
    // w = cos u, dw = −a·sin u dv
    const P = polyExpr(mul(pow(add(ONE, mul(NEG1, pow(W, num(2)))), num((m - 1) / 2)), pow(W, num(n))));
    if (!P) return null;
    return subst(div(neg(integratePolyIn(P, W)), a), { _w: fn("cos", u) });
  }
  if (n % 2 === 1) {
    const P = polyExpr(mul(pow(W, num(m)), pow(add(ONE, mul(NEG1, pow(W, num(2)))), num((n - 1) / 2))));
    if (!P) return null;
    return subst(div(integratePolyIn(P, W), a), { _w: fn("sin", u) });
  }
  // beide gerade: sin² = (1 − c)/2, cos² = (1 + c)/2 mit c = cos 2u
  const P = polyExpr(mul(pow(mul(num(1, 2), add(ONE, mul(NEG1, W))), num(m / 2)), pow(mul(num(1, 2), add(ONE, W)), num(n / 2))));
  if (!P) return null;
  const x = sym(v);
  const u2 = simplify(mul(num(2), u));
  const a2 = simplify(mul(num(2), a));
  return sAdd(P.map((c, j) => (rIsZero(c) ? ZERO : sMul([rExpr(c), cosPow(j, u2, a2, x)]))));
}

/** √(A v² + B v + C)^(±1) für ein quadratisches Polynom: arcsin-/ln-Formeln nach quadratischer Ergänzung. */
function sqrtQuadratic(base: Expr, inv: boolean, v: string): Expr | null {
  const c = toPolynomial(base, v);
  if (!c || c.length !== 3) return null;
  const [C, B, A] = [c[0], c[1], c[2]];
  const h = rDiv(rNeg(B), rMul(rat(2n), A));
  const k = rSub(C, rDiv(rMul(B, B), rMul(rat(4n), A)));
  const w = simplify(add(sym(v), rExpr(rNeg(h))));
  const Q = pow(base, num(1, 2));
  if (A.n > 0n) {
    if (k.n === 0n) return null;
    const sA = sqrtRat(A);
    const lnPart = fn("ln", fn("abs", add(mul(sA, w), Q)));
    if (inv) return div(lnPart, sA);
    return sAdd([sMul([num(1, 2), w, Q]), sMul([rExpr(rDiv(k, rat(2n))), sPow(sA, NEG1), lnPart])]);
  }
  if (k.n <= 0n) return null;
  const sA = sqrtRat(rNeg(A));
  const sK = sqrtRat(k);
  const asin = fn("arcsin", sMul([sA, w, sPow(sK, NEG1)]));
  if (inv) return div(asin, sA);
  return sAdd([sMul([num(1, 2), w, Q]), sMul([rExpr(rDiv(k, rat(2n))), sPow(sA, NEG1), asin])]);
}

// ---------- Hauptregeln ----------
function integFnLinear(name: string, u: Expr, a: Expr): Expr | null {
  switch (name) {
    case "sin": return div(neg(fn("cos", u)), a);
    case "cos": return div(fn("sin", u), a);
    case "tan": return div(neg(LN(fn("cos", u))), a);
    case "cot": return div(LN(fn("sin", u)), a);
    case "sinh": return div(fn("cosh", u), a);
    case "cosh": return div(fn("sinh", u), a);
    case "tanh": return div(fn("ln", fn("cosh", u)), a);
    case "ln": return div(mul(u, add(fn("ln", u), NEG1)), a);
    case "abs": return div(mul(u, fn("abs", u)), mul(num(2), a));
    case "sign": return div(fn("abs", u), a);
    case "arctan": return div(add(mul(u, fn("arctan", u)), mul(num(-1, 2), fn("ln", add(ONE, pow(u, num(2)))))), a);
    case "arcsin": return div(add(mul(u, fn("arcsin", u)), pow(add(ONE, mul(NEG1, pow(u, num(2)))), num(1, 2))), a);
    case "arccos": return div(add(mul(u, fn("arccos", u)), mul(NEG1, pow(add(ONE, mul(NEG1, pow(u, num(2)))), num(1, 2)))), a);
    default: return null;
  }
}

function integPow(e: Extract<Expr, { t: "pow" }>, v: string): Expr | null {
  if (!dep(e.exp, v)) {
    if (e.exp.t === "num" && e.exp.d === 2n && (e.exp.n === 1n || e.exp.n === -1n) && !linearIn(e.base, v)) {
      const r = sqrtQuadratic(e.base, e.exp.n === -1n, v);
      if (r) return r;
    }
    const L = linearIn(e.base, v);
    if (L && e.exp.t === "num") {
      if (e.exp.n === -1n && e.exp.d === 1n) return div(LN(e.base), L.a);
      const n1 = simplify(add(e.exp, ONE));
      return div(pow(e.base, n1), mul(n1, L.a));
    }
    if (e.base.t === "fn" && e.exp.t === "num" && e.exp.d === 1n && e.base.args.length === 1) {
      const u = e.base.args[0];
      const L2 = linearIn(u, v);
      if (!L2) return null;
      const n = e.exp.n;
      const a = L2.a;
      const x = sym(v);
      const nm = e.base.name;
      const k = Number(n < 0n ? -n : n);
      if (k <= 30) {
        if (nm === "sin" && n >= 2n) return sinPow(k, u, a, x);
        if (nm === "cos" && n >= 2n) return cosPow(k, u, a, x);
        if (nm === "tan" && n >= 2n) return tanPow(k, u, a, x);
        if (nm === "cos" && n <= -3n) return secPow(k, u, a, x);
        if (nm === "sin" && n <= -3n) return cscPow(k, u, a, x);
        if (nm === "ln" && n >= 2n) return div(lnPow(k, u), a);
      }
      if (nm === "cos" && n === -2n) return div(fn("tan", u), a);
      if (nm === "sin" && n === -2n) return div(neg(fn("cot", u)), a);
      if (nm === "cosh" && n === -2n) return div(fn("tanh", u), a);
      if (nm === "sin" && n === 2n) return sAdd([div(x, num(2)), neg(div(fn("sin", mul(num(2), u)), mul(num(4), a)))]);
      if (nm === "cos" && n === 2n) return sAdd([div(x, num(2)), div(fn("sin", mul(num(2), u)), mul(num(4), a))]);
      if (nm === "tan" && n === 2n) return sAdd([div(fn("tan", u), a), neg(x)]);
      if (nm === "cos" && n === -1n) return div(LN(add(pow(fn("cos", u), NEG1), fn("tan", u))), a);
      if (nm === "sin" && n === -1n) return div(fn("ln", fn("abs", fn("tan", div(u, num(2))))), a);
    }
    return null;
  }
  if (!dep(e.base, v)) {
    const L = linearIn(e.exp, v);
    if (!L) return null;
    if (e.base.t === "sym" && e.base.name === "e") return div(e, L.a);
    return div(e, mul(L.a, fn("ln", e.base)));
  }
  return null;
}

const isExp = (g: Expr, v: string): g is Extract<Expr, { t: "pow" }> =>
  g.t === "pow" && g.base.t === "sym" && g.base.name === "e" && linearIn(g.exp, v) !== null;
const isTrig = (g: Expr, v: string): g is Extract<Expr, { t: "fn" }> =>
  g.t === "fn" && (g.name === "sin" || g.name === "cos" || g.name === "sinh" || g.name === "cosh") && linearIn(g.args[0], v) !== null;

function integMul(e: Extract<Expr, { t: "mul" }>, v: string, depth: number): Expr | null {
  const consts = e.args.filter((a) => !dep(a, v));
  const rest = e.args.filter((a) => dep(a, v));
  if (consts.length) {
    const inner = rest.length === 1 ? rest[0] : ({ t: "mul", args: rest } as Expr);
    const r = integ(inner, v, depth);
    return r ? sMul([...consts, r]) : null;
  }
  // rationale Funktion?
  const rf = rationalForm(e, v);
  if (rf && polyDeg(rf.Q) >= 1) {
    const r = integRational(rf.P, rf.Q, v);
    if (r) return r;
  }
  // sin^m(u)·cos^n(u) mit gleichem linearem Argument
  {
    const split = (g: Expr): { name: string; n: number; u: Expr } | null => {
      if (g.t === "fn" && (g.name === "sin" || g.name === "cos") && g.args.length === 1) return { name: g.name, n: 1, u: g.args[0] };
      if (g.t === "pow" && g.exp.t === "num" && g.exp.d === 1n && g.exp.n > 0n && g.exp.n < 20n && g.base.t === "fn" && (g.base.name === "sin" || g.base.name === "cos")) {
        return { name: g.base.name, n: Number(g.exp.n), u: g.base.args[0] };
      }
      return null;
    };
    const parts = rest.map(split);
    if (parts.length === 2 && parts[0] && parts[1] && parts[0].name !== parts[1].name && key(parts[0].u) === key(parts[1].u)) {
      const L = linearIn(parts[0].u, v);
      if (L) {
        const sn = parts[0].name === "sin" ? parts[0] : parts[1];
        const cs = parts[0].name === "cos" ? parts[0] : parts[1];
        const r = sinCosProduct(sn.n, cs.n, parts[0].u, L.a, v);
        if (r) return r;
      }
    }
  }
  // e^{ax+c}·sin/cos(bx+d)
  if (rest.length === 2) {
    const ex = rest.find((g) => isExp(g, v));
    const tr = rest.find((g) => g.t === "fn" && (g.name === "sin" || g.name === "cos") && linearIn(g.args[0], v));
    if (ex && tr && ex.t === "pow" && tr.t === "fn") {
      const a = linearIn(ex.exp, v)!.a;
      const b = linearIn(tr.args[0], v)!.a;
      const den = add(pow(a, num(2)), pow(b, num(2)));
      const s = fn("sin", tr.args[0]);
      const c = fn("cos", tr.args[0]);
      const body = tr.name === "sin" ? add(mul(a, s), mul(NEG1, b, c)) : add(mul(a, c), mul(b, s));
      return div(mul(ex, body), den);
    }
  }
  // Polynom · g  (partielle Integration)
  const polys = e.args.filter((g) => toPolynomial(g, v) !== null);
  const others = e.args.filter((g) => toPolynomial(g, v) === null);
  if (polys.length >= 1 && others.length === 1 && depth <= 8) {
    const P = expand(mul(...polys));
    const g = others[0];
    const dP = deriv(P, v);
    if (dP && (isExp(g, v) || isTrig(g, v))) {
      const G = integ(g, v, depth + 1);
      const R = G && integ(simplify(mul(dP, G)), v, depth + 1);
      if (G && R) return sAdd([sMul([P, G]), neg(R)]);
    }
    if (g.t === "fn" && (g.name === "ln" || g.name === "arctan") && g.args.length === 1) {
      const Qp = integ(P, v, depth + 1);
      const dg = deriv(g, v);
      const R = Qp && dg && integ(simplify(mul(Qp, dg)), v, depth + 1);
      if (Qp && R) return sAdd([sMul([Qp, g]), neg(R)]);
    }
  }
  return uSub(e, v, depth);
}

function integ(e0: Expr, v: string, depth: number): Expr | null {
  const e = e0;
  if (!dep(e, v)) return sMul([e, sym(v)]);
  if (depth > 8) return null;
  switch (e.t) {
    case "sym":
      return div(pow(e, num(2)), num(2));
    case "add": {
      const parts: Expr[] = [];
      for (const a of e.args) {
        const r = integ(a, v, depth);
        if (!r) return null;
        parts.push(r);
      }
      return sAdd(parts);
    }
    case "mul":
      return integMul(e, v, depth);
    case "pow": {
      const r = integPow(e, v);
      if (r) return r;
      const rf = rationalForm(e, v);
      if (rf && polyDeg(rf.Q) >= 1) {
        const q = integRational(rf.P, rf.Q, v);
        if (q) return q;
      }
      return uSub(e, v, depth);
    }
    case "fn": {
      const L = e.args.length === 1 ? linearIn(e.args[0], v) : null;
      if (L) {
        const r = integFnLinear(e.name, e.args[0], L.a);
        if (r) return r;
      }
      return uSub(e, v, depth);
    }
    default:
      return null;
  }
}

const SAMPLE = [0.37, 1.13, 2.71, -0.62, -1.9, 0.91, 4.2, -3.3];

/** Stimmt d/dv F = e (numerisch an mehreren Stellen)? */
function verify(F: Expr, e: Expr, v: string): boolean {
  const dF = deriv(F, v);
  if (!dF) return false;
  const syms = [...new Set([...freeSymbols(F), ...freeSymbols(e)])].filter((s) => s !== v);
  const params: Record<string, number> = {};
  syms.forEach((s, i) => (params[s] = 1.37 + 0.73 * i));
  try {
    const a = compile(dF, [v], { params });
    const b = compile(e, [v], { params });
    let ok = 0;
    for (const x of SAMPLE) {
      const p = a(x);
      const q = b(x);
      if (!Number.isFinite(p) || !Number.isFinite(q)) continue;
      if (Math.abs(p - q) <= 1e-7 * (1 + Math.abs(q))) ok++;
      else return false;
    }
    return ok >= 3;
  } catch {
    return false;
  }
}

/** Stammfunktion (ohne Integrationskonstante) oder null, wenn keine in geschlossener Form gefunden wurde. */
export function antiderivative(e: Expr, v: string): Expr | null {
  let F: Expr | null = null;
  try {
    F = integ(simplify(e), v, 0);
  } catch {
    return null;
  }
  if (!F) return null;
  const S = simplify(F);
  let E = S;
  try {
    E = expand(S, false); // Funktionsargumente (z. B. in ln|…|) bleiben unangetastet
  } catch {
    /* zu groß: unexpandiert lassen */
  }
  if (verify(E, e, v)) return E;
  return verify(S, e, v) ? S : null;
}

export interface DefiniteResult {
  F: Expr | null;
  exact: Expr | null;
  numeric: number | null;
  note?: string;
}

/** Bestimmtes Integral: exakt über die Stammfunktion (nur wenn sie zur numerischen Kontrolle passt) und numerisch. */
export function definiteIntegral(e: Expr, v: string, a: Expr, b: Expr, params: Record<string, number> = {}): DefiniteResult {
  let numeric: number | null = null;
  let lo = NaN;
  let hi = NaN;
  let f: ((x: number) => number) | null = null;
  try {
    const g = compile(e, [v], { params });
    f = (x: number) => g(x);
    lo = compile(a, [], { params })();
    hi = compile(b, [], { params })();
    numeric = integrateNum(f, lo, hi).value;
    if (!Number.isFinite(numeric)) numeric = null;
  } catch {
    numeric = null;
  }
  const boundsKnown = Number.isFinite(lo) && Number.isFinite(hi);
  const F = antiderivative(e, v);
  let exact: Expr | null = null;
  let note: string | undefined;
  if (F) {
    // Polstellen im Inneren machen das Integral uneigentlich: dann keine exakte Aussage über F(b) − F(a)
    let pole: number | null = null;
    if (f && boundsKnown && hi !== lo) {
      const [p0, p1] = lo < hi ? [lo, hi] : [hi, lo];
      const eps = 1e-9 * (1 + Math.abs(p1 - p0));
      pole = findPoles(f, p0, p1).find((x) => x > p0 + eps && x < p1 - eps) ?? null;
    }
    if (pole !== null) {
      note = `Polstelle bei x ≈ ${Math.abs(pole) < 1e-9 ? 0 : Number(pole.toPrecision(6))} im Integrationsintervall – uneigentliches Integral, kein exakter Wert`;
    } else {
      const val = simplify(add(subst(F, { [v]: b }), mul(NEG1, subst(F, { [v]: a }))));
      try {
        const approx = compile(val, [], { params })();
        if (!Number.isFinite(approx)) note = "Das Integral divergiert (uneigentlich)";
        else if (numeric !== null ? Math.abs(approx - numeric) <= 1e-6 * (1 + Math.abs(numeric)) : !boundsKnown) exact = val;
        else note = "Stammfunktion passt nicht zur numerischen Kontrolle (Unstetigkeit/uneigentliches Integral) – nur Näherung";
      } catch {
        /* nicht auswertbar */
      }
    }
  }
  return { F, exact, numeric, note };
}

/** Vereinfachung eines Integralknotens (aus simplify): exakt, wenn möglich. */
export function integralNode(e: Extract<Expr, { t: "int" }>): Expr | null {
  if (!e.from && !e.to) return antiderivative(e.body, e.v);
  if (!e.from || !e.to) return null;
  if (freeSymbols(e.from).has(e.v) || freeSymbols(e.to).has(e.v)) return null;
  const r = definiteIntegral(e.body, e.v, e.from, e.to);
  return r.exact;
}
