// Exakte Grenzwerte: direkte Einsetzung, rationale Funktionen bei ±∞, L'Hôpital (0/0, ∞/∞, 0·∞, a^b),
// Pole mit Vorzeichen. Jedes Ergebnis wird mit der numerischen Näherung verglichen – im Zweifel gibt es null.
import { type Expr, ZERO, ONE, NEG1, num, sym, mul, pow, fn, subst } from "./ast.ts";
import { simplify, sMul } from "./simplify.ts";
import { derivative } from "./diff.ts";
import { compile, evalNumber, limitNumeric } from "./eval.ts";
import { rationalForm, polyDeg, rNum, rExpr, rDiv } from "./poly.ts";

type Dir = "" | "+" | "-";
const INF: Expr = sym("infty");
const NEGINF: Expr = mul(NEG1, INF);

function num2(e: Expr): number | null {
  try {
    const x = evalNumber(e);
    return Number.isNaN(x) ? null : x;
  } catch {
    return null;
  }
}

/** Punkte nahe am Grenzpunkt (zwei Abstände, damit sich langsames Wachstum erkennen lässt). */
function probes(av: number, dir: Dir): number[][] {
  if (!Number.isFinite(av)) return [[av > 0 ? 1e4 : -1e4, av > 0 ? 1e10 : -1e10]];
  const s = 1 + Math.abs(av);
  const mk = (sg: number): number[] => [av + sg * 1e-4 * s, av + sg * 1e-12 * s];
  return dir === "+" ? [mk(1)] : dir === "-" ? [mk(-1)] : [mk(-1), mk(1)];
}

function nature(e: Expr, v: string, av: number, dir: Dir): "zero" | "inf" | "finite" | "?" {
  let f: (...a: number[]) => number;
  try {
    f = compile(e, [v]);
  } catch {
    return "?";
  }
  const kinds = probes(av, dir).map(([p1, p2]) => {
    const m1 = Math.abs(f(p1));
    const m2 = Math.abs(f(p2));
    if (Number.isNaN(m1) || Number.isNaN(m2)) return "?";
    if (m2 < 1e-6 && m2 <= m1) return "zero";
    if (m2 > 1e6 || (m2 > 8 && m2 > 1.3 * m1)) return "inf";
    return "finite";
  });
  return kinds.every((k) => k === kinds[0]) ? (kinds[0] as "zero" | "inf" | "finite" | "?") : "?";
}

function splitQuot(e: Expr): [Expr, Expr] | null {
  const facs = e.t === "mul" ? e.args : [e];
  const top: Expr[] = [];
  const den: Expr[] = [];
  for (const f of facs) {
    if (f.t === "pow" && f.exp.t === "num" && f.exp.n < 0n) den.push(simplify(pow(f.base, num(-f.exp.n, f.exp.d))));
    else if (f.t === "pow" && f.base.t === "sym" && f.base.name === "e" && f.exp.t === "mul" && f.exp.args[0].t === "num" && f.exp.args[0].n < 0n) {
      den.push(simplify(pow(f.base, sMul([NEG1, f.exp]))));
    } else top.push(f);
  }
  if (!den.length) return null;
  return [top.length ? simplify(mul(...top)) : ONE, simplify(mul(...den))];
}

function signAt(e: Expr, v: string, x: number): number {
  try {
    return Math.sign(compile(e, [v])(x));
  } catch {
    return NaN;
  }
}

function lim(e: Expr, v: string, to: Expr, av: number, dir: Dir, depth: number): Expr | null {
  if (depth > 6) return null;
  // 1. Einsetzen (endlicher Punkt)
  if (Number.isFinite(av)) {
    try {
      // Prüfung am rohen Ausdruck: simplify würde 0·(1/0) zu 0 kürzen und eine Division durch null verstecken
      const raw = num2(subst(e, { [v]: to }));
      if (raw !== null && Number.isFinite(raw)) {
        const s = simplify(subst(e, { [v]: to }));
        const sv = num2(s);
        if (sv !== null && Number.isFinite(sv)) return s;
      }
    } catch {
      /* weiter */
    }
  }
  // 2. rationale Funktion bei ±∞: Grad von Zähler und Nenner
  if (!Number.isFinite(av)) {
    const rf = rationalForm(e, v);
    if (rf) {
      const dP = polyDeg(rf.P);
      const dQ = polyDeg(rf.Q);
      const r = rDiv(rf.P[rf.P.length - 1], rf.Q[rf.Q.length - 1]);
      if (dP < dQ) return ZERO;
      if (dP === dQ) return rExpr(r);
      const neg = (rNum(r) < 0) !== (av < 0 && (dP - dQ) % 2 === 1);
      return neg ? NEGINF : INF;
    }
  }
  // 3. Quotient: 0/0 und ∞/∞ (L'Hôpital), Zähler endlich/Nenner unendlich, Pole
  const q = splitQuot(e);
  if (q) {
    const [N, D] = q;
    const nN = nature(N, v, av, dir);
    const nD = nature(D, v, av, dir);
    if ((nN === "zero" && nD === "zero") || (nN === "inf" && nD === "inf")) {
      try {
        const next = simplify(mul(derivative(N, v), pow(derivative(D, v), NEG1)));
        return lim(next, v, to, av, dir, depth + 1);
      } catch {
        return null;
      }
    }
    if (nD === "inf" && nN === "finite") return ZERO;
    if (nD === "zero" && nN === "finite") {
      const sides = probes(av, dir).map(([p1]) => signAt(N, v, p1) * signAt(D, v, p1));
      if (sides.every((s) => s > 0)) return INF;
      if (sides.every((s) => s < 0)) return NEGINF;
      return null;
    }
  }
  // 4. 0·∞ → Quotient
  if (e.t === "mul" && e.args.length === 2) {
    const [A, B] = e.args;
    const nA = nature(A, v, av, dir);
    const nB = nature(B, v, av, dir);
    const [Z, I] = nA === "zero" && nB === "inf" ? [A, B] : nB === "zero" && nA === "inf" ? [B, A] : [null, null];
    if (Z && I) {
      // beide Umformungen versuchen: I/(1/Z) und Z/(1/I) – je nachdem, welche Ableitung einfacher wird
      for (const [top, bot] of [[I, Z], [Z, I]]) {
        try {
          const next = simplify(mul(derivative(top, v), pow(derivative(pow(bot, NEG1), v), NEG1)));
          const r = lim(next, v, to, av, dir, depth + 1);
          if (r) return r;
        } catch {
          /* nächste Umformung */
        }
      }
      return null;
    }
  }
  // 5. Potenz mit variabler Basis und variablem Exponenten: a^b = e^{b·ln a}
  if (e.t === "pow") {
    try {
      const L = lim(simplify(mul(e.exp, fn("ln", e.base))), v, to, av, dir, depth + 1);
      if (L) {
        const lv = num2(L);
        if (lv === -Infinity) return ZERO;
        if (lv !== null && Number.isFinite(lv)) return simplify(pow(sym("e"), L));
        if (lv === Infinity) return INF;
      }
    } catch {
      return null;
    }
  }
  return null;
}

/** Exakter Grenzwert von body für v → to (to darf ±∞ sein), oder null. */
export function exactLimit(body: Expr, v: string, to: Expr, dir: Dir): Expr | null {
  const av = num2(to);
  if (av === null) return null;
  let f: (...a: number[]) => number;
  try {
    f = compile(body, [v]);
  } catch {
    return null;
  }
  const numeric = limitNumeric((x) => f(x), av, dir);
  if (Number.isNaN(numeric)) return null; // existiert (numerisch) nicht
  let cand: Expr | null;
  try {
    cand = lim(simplify(body), v, to, av, dir, 0);
  } catch {
    return null;
  }
  if (!cand) return null;
  const cv = num2(cand);
  if (cv === null) return null;
  // die numerische Näherung konvergiert bei x·ln x o. Ä. nur langsam: grobe Fehler (Vorzeichen, falscher Wert) fängt 1e-3 trotzdem ab
  if (Number.isFinite(numeric)) return Number.isFinite(cv) && Math.abs(cv - numeric) <= 1e-3 * (1 + Math.abs(numeric)) ? cand : null;
  return cv === numeric ? cand : null;
}
