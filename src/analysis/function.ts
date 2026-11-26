// Funktionsanalyse: Nullstellen, Extrema, Wendepunkte, Asymptoten, Schnittpunkte, Tangente/Normale, Integral, Fläche.
// Rationale Funktionen werden exakt behandelt, alles andere numerisch (und entsprechend gekennzeichnet).
import {
  type Expr, ZERO, NEG1, num, sym, add, mul, subst, simplify, expand, derivative, compile, toLatex, evalNumber,
  rationalForm, solvePolynomial, bindParams, solveEquation, definiteIntegral, scanRoots, scanExtrema, findPoles,
  endBehavior, recognize, rationalOf, sAdd, exactRoot, solveSystem,
} from "../engine/index.ts";
import {
  type Rat, rat, rNum, rExpr, polyMul, polyDeriv, polySub, polyDeg, polyDivMod, polyEvalNum, polyToExpr, polyIsZero, rDiv,
} from "../engine/poly.ts";

export interface Pt {
  x: number;
  y: number;
  xExpr: Expr | null;
  yExpr: Expr | null;
  /** Vermutung (nur numerisch erkannt) für x, falls vorhanden */
  xGuess: Expr | null;
  /** true: x und y sind exakte Ausdrücke */
  exact: boolean;
}

export interface FunctionAnalysis {
  exact: boolean;
  method: "rational" | "numeric";
  yIntercept: Pt | null;
  roots: Pt[];
  minima: Pt[];
  maxima: Pt[];
  inflections: Pt[];
  holes: Pt[];
  vertical: { x: number; xExpr: Expr | null; exact: boolean }[];
  horizontal: { side: "both" | "+" | "-"; y: number; yExpr: Expr | null; exact: boolean; guess: boolean }[];
  slant: { side: "both" | "+" | "-"; m: number; b: number; mExpr: Expr | null; bExpr: Expr | null; exact: boolean; guess: boolean }[];
  notes: string[];
}

const close = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * (1 + Math.abs(a));
const hasSqrt = (e: Expr): boolean => {
  if (e.t === "pow" && e.exp.t === "num" && e.exp.d === 2n) return true;
  if (e.t === "add" || e.t === "mul") return e.args.some(hasSqrt);
  if (e.t === "pow") return hasSqrt(e.base);
  return false;
};

/** P(x)/Q(x) an einer algebraischen Stelle exakt (Nenner ggf. rationalisiert). */
function exactAt(P: Rat[], Q: Rat[], x: Expr): Expr | null {
  try {
    const at = (c: Rat[]): Expr => expand(subst(polyToExpr(c, "_t"), { _t: x }));
    const N = at(P);
    const D = at(Q);
    if (D.t === "num") return D.n === 0n ? null : expand(mul(N, num(D.d, D.n)));
    const terms = D.t === "add" ? D.args : [D];
    const conj = add(...terms.map((t) => (hasSqrt(t) ? mul(NEG1, t) : t)));
    const D2 = expand(mul(D, conj));
    if (D2.t !== "num" || D2.n === 0n) return null;
    return expand(mul(N, conj, num(D2.d, D2.n)));
  } catch {
    return null;
  }
}

/** Funktionswert an einer exakten Stelle. */
function exactValue(g: Expr, v: string, x: Expr, rf: { P: Rat[]; Q: Rat[] } | null): Expr | null {
  if (rf) {
    const r = exactAt(rf.P, rf.Q, x);
    if (r) return r;
  }
  try {
    const y = simplify(subst(g, { [v]: x }));
    return Number.isFinite(evalNumber(y)) ? y : null;
  } catch {
    return null;
  }
}

const tidy = (x: number): number => (Math.abs(x) < 1e-12 ? 0 : x);
const mkPt = (x: number, y: number, xExpr: Expr | null, yExpr: Expr | null, labelExact: boolean, xGuess: Expr | null = null): Pt => ({
  x: tidy(x), y: tidy(y), xExpr, yExpr, xGuess, exact: labelExact && xExpr !== null && yExpr !== null,
});

function signChange(c: number[], x: number, others: number[]): -1 | 0 | 1 {
  let d = 1e-5 * (1 + Math.abs(x));
  for (const o of others) if (!close(o, x)) d = Math.min(d, 0.3 * Math.abs(o - x));
  const l = polyEvalNum(c, x - d);
  const r = polyEvalNum(c, x + d);
  return l < 0 && r > 0 ? 1 : l > 0 && r < 0 ? -1 : 0;
}

export function analyzeFunction(expr: Expr, v: string, params: Record<string, number>, range: [number, number]): FunctionAnalysis {
  const bound = bindParams(expr, params, [v]);
  const labelExact = !bound.used;
  const g = simplify(bound.expr);
  // Numerische Suche am ungekürzten Ausdruck: Vereinfachen darf den Definitionsbereich nicht erweitern (z. B. (√x)² → x)
  const f0 = compile(bound.expr, [v]);
  const f = (x: number): number => f0(x);
  const out: FunctionAnalysis = {
    exact: false, method: "numeric", yIntercept: null, roots: [], minima: [], maxima: [], inflections: [],
    holes: [], vertical: [], horizontal: [], slant: [], notes: [],
  };
  if (bound.used) out.notes.push("Parameter wurden durch ihre aktuellen Werte ersetzt – alle Ergebnisse sind Näherungen");
  if (g.t === "restrict") out.notes.push("Mit Definitionsbereich: numerische Analyse");

  const rf = g.t === "restrict" ? null : (rationalForm(bound.expr, v, false) ?? rationalForm(g, v));
  if (rf) {
    out.method = "rational";
    out.exact = labelExact;
    const { P, Q } = rf;
    const rootsP = solvePolynomial(P).roots;
    const rootsQ = polyDeg(Q) >= 1 ? solvePolynomial(Q).roots : [];
    const inQ = (x: number): boolean => rootsQ.some((q) => close(q.value, x));
    const yAt = (x: number): number => f(x);

    // y-Achsenabschnitt
    const q0 = Q[0];
    if (q0.n !== 0n) {
      const y0 = rDiv(P[0], q0);
      out.yIntercept = mkPt(0, rNum(y0), ZERO, rExpr(y0), labelExact);
    }
    // Nullstellen (Stellen mit Nenner 0 gehören nicht zum Definitionsbereich)
    for (const r of rootsP) if (!inQ(r.value)) out.roots.push(mkPt(r.value, 0, r.expr, ZERO, labelExact));
    // Pole und Lücken
    for (const q of rootsQ) {
      const p = rootsP.find((x) => close(x.value, q.value));
      if (!p || q.mult > p.mult) out.vertical.push({ x: q.value, xExpr: q.expr, exact: labelExact && q.expr !== null });
      else {
        const h = 1e-6 * (1 + Math.abs(q.value));
        const yv = (yAt(q.value - h) + yAt(q.value + h)) / 2;
        let yExpr: Expr | null = null;
        if (q.expr && q.expr.t === "num") {
          let P1 = P;
          let Q1 = Q;
          const lin: Rat[] = [rat(-q.expr.n, q.expr.d), rat(1n)];
          for (let k = 0; k < q.mult; k++) {
            P1 = polyDivMod(P1, lin).q;
            Q1 = polyDivMod(Q1, lin).q;
          }
          yExpr = exactAt(P1, Q1, q.expr);
        }
        out.holes.push(mkPt(q.value, yv, q.expr, yExpr, labelExact, recognize(yv)));
      }
    }
    // Extrema: f' = (P'Q − PQ')/Q²
    const N1 = polySub(polyMul(polyDeriv(P), Q), polyMul(P, polyDeriv(Q)));
    const N1num = N1.map(rNum);
    if (!polyIsZero(N1)) {
      const crit = solvePolynomial(N1).roots.filter((r) => !inQ(r.value));
      const allVals = crit.map((c) => c.value);
      for (const c of crit) {
        if (c.mult % 2 === 0) continue;
        const sc = signChange(N1num, c.value, allVals);
        if (sc === 0) continue;
        const y = yAt(c.value);
        const yExpr = c.expr ? exactValue(g, v, c.expr, rf) : null;
        (sc === 1 ? out.minima : out.maxima).push(mkPt(c.value, y, c.expr, yExpr, labelExact));
      }
    }
    // Wendepunkte: f'' = (N1' Q − 2 N1 Q') / Q³
    const N2 = polySub(polyMul(polyDeriv(N1), Q), polyMul([rat(2n)], polyMul(N1, polyDeriv(Q))));
    if (!polyIsZero(N2)) {
      const cand = solvePolynomial(N2).roots.filter((r) => !inQ(r.value));
      const vals = cand.map((c) => c.value);
      const N2num = N2.map(rNum);
      for (const c of cand) {
        if (c.mult % 2 === 0 || signChange(N2num, c.value, vals) === 0) continue;
        const y = yAt(c.value);
        out.inflections.push(mkPt(c.value, y, c.expr, c.expr ? exactValue(g, v, c.expr, rf) : null, labelExact));
      }
    }
    // Asymptoten
    const dP = polyDeg(P);
    const dQ = polyDeg(Q);
    const lcP = P[P.length - 1];
    const lcQ = Q[Q.length - 1];
    if (dQ === 0) {
      // Polynom: Asymptoten gibt es nicht (eine Gerade wäre ihre eigene „Asymptote“)
    } else if (dP < dQ) out.horizontal.push({ side: "both", y: 0, yExpr: ZERO, exact: labelExact, guess: false });
    else if (dP === dQ) {
      const y = rDiv(lcP, lcQ);
      out.horizontal.push({ side: "both", y: rNum(y), yExpr: rExpr(y), exact: labelExact, guess: false });
    } else if (dP === dQ + 1) {
      const { q } = polyDivMod(P, Q);
      const b = q[0];
      const m = q[1];
      out.slant.push({ side: "both", m: rNum(m), b: rNum(b), mExpr: rExpr(m), bExpr: rExpr(b), exact: labelExact, guess: false });
    }
  } else {
    const [a, b] = range;
    // y-Achsenabschnitt
    const y0 = f(0);
    if (Number.isFinite(y0)) {
      let yExpr: Expr | null = null;
      try {
        const s = simplify(subst(g, { [v]: ZERO }));
        if (Number.isFinite(evalNumber(s))) yExpr = s;
      } catch {
        /* nicht auswertbar */
      }
      out.yIntercept = mkPt(0, y0, ZERO, yExpr, labelExact);
    }
    // Stellen, die sich durch exaktes Einsetzen beweisen lassen, werden zu exakten Ausdrücken
    const proven = (target: Expr, x: number): Expr | null => exactRoot(target, v, x);
    const place = (x: number, y: number, xe: Expr | null): Pt =>
      xe ? mkPt(x, y, xe, exactValue(g, v, xe, null), labelExact) : mkPt(x, y, null, null, false, recognize(x));
    for (const x of scanRoots(f, a, b)) {
      const xe = proven(g, x);
      out.roots.push(xe ? mkPt(x, 0, xe, ZERO, labelExact) : mkPt(x, 0, null, ZERO, false, recognize(x)));
    }
    let df: ((x: number) => number) | undefined;
    let ddf: ((x: number) => number) | undefined;
    let dg: Expr | null = null;
    let ddg: Expr | null = null;
    try {
      dg = derivative(g, v);
      const d1 = compile(dg, [v]);
      df = (x) => d1(x);
      ddg = derivative(g, v, 2);
      const d2 = compile(ddg, [v]);
      ddf = (x) => d2(x);
    } catch {
      out.notes.push("Keine symbolische Ableitung verfügbar: Wendepunkte werden nicht bestimmt");
    }
    for (const e of scanExtrema(f, a, b, df)) {
      const xe = dg ? proven(dg, e.x) : null;
      (e.type === "min" ? out.minima : out.maxima).push(place(e.x, e.y, xe));
    }
    if (ddf && ddg) {
      const dd = ddf;
      for (const x of scanRoots(dd, a, b)) {
        const h = 1e-4 * (1 + Math.abs(x));
        if (dd(x - h) * dd(x + h) < 0) out.inflections.push(place(x, f(x), proven(ddg, x)));
      }
    }
    for (const x of findPoles(f, a, b)) out.vertical.push({ x: tidy(x), xExpr: recognize(x), exact: false });
    const ep = endBehavior(f, 1);
    const em = endBehavior(f, -1);
    const guessY = (y: number): Expr | null => recognize(y);
    if (ep.kind === "horizontal" && em.kind === "horizontal" && Math.abs(ep.y - em.y) < 1e-7 * (1 + Math.abs(ep.y))) {
      out.horizontal.push({ side: "both", y: ep.y, yExpr: guessY(ep.y), exact: false, guess: true });
    } else {
      if (ep.kind === "horizontal") out.horizontal.push({ side: "+", y: ep.y, yExpr: guessY(ep.y), exact: false, guess: true });
      if (em.kind === "horizontal") out.horizontal.push({ side: "-", y: em.y, yExpr: guessY(em.y), exact: false, guess: true });
    }
    const sl = (e: typeof ep, side: "+" | "-") => {
      if (e.kind !== "slant") return;
      out.slant.push({ side, m: e.m, b: e.b, mExpr: recognize(e.m), bExpr: recognize(e.b), exact: false, guess: true });
    };
    if (ep.kind === "slant" && em.kind === "slant" && Math.abs(ep.m - em.m) < 1e-7 && Math.abs(ep.b - em.b) < 1e-5 * (1 + Math.abs(ep.b))) {
      out.slant.push({ side: "both", m: ep.m, b: ep.b, mExpr: recognize(ep.m), bExpr: recognize(ep.b), exact: false, guess: true });
    } else {
      sl(ep, "+");
      sl(em, "-");
    }
  }
  const byX = (p: Pt, q: Pt): number => p.x - q.x;
  [out.roots, out.minima, out.maxima, out.inflections, out.holes].forEach((l) => l.sort(byX));
  out.vertical.sort((p, q) => p.x - q.x);
  return out;
}

// ---------- Schnittpunkte ----------
export function intersections(e1: Expr, e2: Expr, v: string, params: Record<string, number>, range: [number, number]): { points: Pt[]; all: boolean; exact: boolean; note?: string } {
  const r = solveEquation(e1, e2, v, { params }, range);
  const b = bindParams(e1, params, [v]);
  const g = simplify(b.expr);
  const f = compile(b.expr, [v]);
  const rf = g.t === "restrict" ? null : rationalForm(g, v);
  const points = r.solutions.map((s) => {
    const y = f(s.value);
    const yExpr = s.expr ? exactValue(g, v, s.expr, rf) : null;
    return mkPt(s.value, y, s.expr, yExpr, !b.used, s.expr ? null : recognize(s.value));
  });
  return { points, all: r.all, exact: r.exact && !b.used, note: r.note };
}

/** Schnittpunkte zweier Kurven F₁(x,y)=0 und F₂(x,y)=0 (explizit, implizit): exakt, wenn Elimination möglich, sonst numerisch. */
export function intersectCurves(
  F1: Expr,
  F2: Expr,
  params: Record<string, number>,
  xr: [number, number],
  yr: [number, number]
): { points: Pt[]; all: boolean; note?: string; exact: boolean } {
  const r = solveSystem([F1, F2], ["x", "y"], { params }, [xr, yr]);
  const points = r.solutions.map((s) => mkPt(s.values[0], s.values[1], s.exprs[0], s.exprs[1], s.exact, s.exprs[0] ? null : recognize(s.values[0])));
  const note = r.kind === "none" ? "Die Kurven schneiden sich nicht." : r.kind === "unsupported" ? r.note : r.note;
  return { points, all: false, note, exact: points.length > 0 && points.every((p) => p.exact) };
}

// ---------- Tangente und Normale ----------
export interface TangentResult {
  point: Pt;
  slope: Expr | null;
  slopeValue: number;
  /** Gleichungen als Relationen (y = … bzw. x = …) */
  tangent: Expr;
  normal: Expr;
  exact: boolean;
}

const relEq = (l: Expr, r: Expr): Expr => ({ t: "rel", ops: ["="], args: [l, r] });

export function tangentNormal(expr: Expr, v: string, params: Record<string, number>, x0: Expr): TangentResult {
  const b = bindParams(expr, params, [v]);
  const g = simplify(b.expr);
  const x0s = simplify(x0);
  const xv = evalNumber(x0s, params);
  const rf = g.t === "restrict" ? null : rationalForm(g, v);
  const f = compile(b.expr, [v]);
  const yv = f(xv);
  if (!Number.isFinite(yv)) throw new Error("Die Funktion ist an dieser Stelle nicht definiert");
  const y0 = exactValue(g, v, x0s, rf);
  const dg = derivative(g, v);
  const m = (() => {
    try {
      const s = simplify(subst(dg, { [v]: x0s }));
      return Number.isFinite(evalNumber(s)) ? s : null;
    } catch {
      return null;
    }
  })();
  const mv = compile(dg, [v])(xv);
  const X = sym("x");
  const Y = sym("y");
  const exact = !b.used && y0 !== null && (m !== null || !Number.isFinite(mv));
  const point = mkPt(xv, yv, x0s, y0, !b.used);
  const y0e = y0 ?? rationalOf(yv);
  const x0e = x0s;
  if (!Number.isFinite(mv)) {
    return { point, slope: null, slopeValue: mv, tangent: relEq(X, x0e), normal: relEq(Y, y0e), exact };
  }
  const me = m ?? rationalOf(mv);
  const tangent = relEq(Y, expand(add(mul(me, X), mul(NEG1, me, x0e), y0e)));
  if (Math.abs(mv) < 1e-12) return { point, slope: me, slopeValue: mv, tangent, normal: relEq(X, x0e), exact };
  const nm = simplify(mul(NEG1, num(1), { t: "pow", base: me, exp: NEG1 }));
  const normal = relEq(Y, expand(add(mul(nm, X), mul(NEG1, nm, x0e), y0e)));
  return { point, slope: me, slopeValue: mv, tangent, normal, exact };
}

// ---------- Integral und Fläche ----------
export interface AreaResult {
  exact: Expr | null;
  numeric: number | null;
  F: Expr | null;
  notes: string[];
}

/** Bestimmtes Integral ∫_a^b e dv, exakt wenn möglich. */
export function integralOf(e: Expr, v: string, params: Record<string, number>, a: Expr, b: Expr): AreaResult {
  const bd = bindParams(e, params, [v]);
  const r = definiteIntegral(simplify(bd.expr), v, simplify(a), simplify(b), {});
  const notes: string[] = [];
  if (bd.used) notes.push("Parameter wurden durch ihre aktuellen Werte ersetzt – Näherung");
  if (r.note) notes.push(r.note);
  return { exact: bd.used ? null : r.exact, numeric: r.numeric, F: bd.used ? null : r.F, notes };
}

/** Fläche zwischen zwei Kurven (e2 = null: zwischen Kurve und x-Achse) über [a, b], getrennt an den Schnittstellen. */
export function areaBetween(e1: Expr, e2: Expr | null, v: string, params: Record<string, number>, a: Expr, b: Expr): AreaResult {
  const notes: string[] = [];
  const B1 = bindParams(e1, params, [v]);
  const B2 = e2 ? bindParams(e2, params, [v]) : { expr: ZERO as Expr, used: false };
  const used = B1.used || B2.used;
  if (used) notes.push("Parameter wurden durch ihre aktuellen Werte ersetzt – Näherung");
  const g1 = simplify(B1.expr);
  const g2 = simplify(B2.expr);
  const D = simplify(add(g1, mul(NEG1, g2)));
  const lo = evalNumber(simplify(a), params);
  const hi = evalNumber(simplify(b), params);
  if (!(Number.isFinite(lo) && Number.isFinite(hi))) throw new Error("Ungültige Integrationsgrenzen");
  const [p0, p1] = lo <= hi ? [lo, hi] : [hi, lo];
  const aE = lo <= hi ? simplify(a) : simplify(b);
  const bE = lo <= hi ? simplify(b) : simplify(a);
  const eps = 1e-9 * (1 + Math.abs(p1 - p0));
  const sol = solveEquation(g1, g2, v, {}, [p0, p1]);
  const cuts = sol.solutions.filter((s) => s.value > p0 + eps && s.value < p1 - eps);
  if (cuts.some((c) => !c.expr)) notes.push("Schnittstellen nur numerisch bekannt – kein exakter Wert");
  const pts: { value: number; expr: Expr | null }[] = [
    { value: p0, expr: aE },
    ...cuts.map((c) => ({ value: c.value, expr: c.expr })),
    { value: p1, expr: bE },
  ];
  const f = compile(D, [v]);
  let numeric: number | null = 0;
  let exactParts: Expr[] | null = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [u, w] = [pts[i], pts[i + 1]];
    const mid = f((u.value + w.value) / 2);
    const sign = mid >= 0 ? 1 : -1;
    const integrand = sign > 0 ? D : simplify(mul(NEG1, D));
    const r = definiteIntegral(integrand, v, u.expr ?? rationalOf(u.value), w.expr ?? rationalOf(w.value), {});
    if (r.note) notes.push(r.note);
    numeric = numeric !== null && r.numeric !== null ? numeric + r.numeric : null;
    if (exactParts && r.exact && u.expr && w.expr) exactParts.push(r.exact);
    else exactParts = null;
  }
  const exact = !used && exactParts ? simplify(sAdd(exactParts)) : null;
  return { exact, numeric, F: null, notes: [...new Set(notes)] };
}

export { toLatex };
