// Gleichungen und Gleichungssysteme lösen: exakt (Polynome, rationale Funktionen, lineare Systeme), sonst numerisch.
import {
  type Expr, ZERO, NEG1, num, sym, add, mul, freeSymbols, subst, numFromString, EngineError,
} from "./ast.ts";
import { simplify, expand } from "./simplify.ts";
import { derivative } from "./diff.ts";
import { compile, evalNumber, type Context } from "./eval.ts";
import {
  type Rat, rat, rNum, rExpr, rationalForm, solvePolynomial, polyDeg, polyIsZero, solveLinearRat,
} from "./poly.ts";
import { scanRoots, recognize } from "./roots.ts";

export interface Solution {
  value: number;
  /** exakter Ausdruck, falls bestimmbar */
  expr: Expr | null;
  mult: number;
}

export interface SolveResult {
  all: boolean;
  solutions: Solution[];
  /** true, wenn alle Lösungen exakt (symbolisch) bestimmt wurden */
  exact: boolean;
  method: "polynomial" | "rational" | "numeric";
  note?: string;
}

export function rationalOf(x: number): Expr {
  const a = Math.abs(x);
  let s = a < 1e-9 ? "0" : Number(a.toPrecision(10)).toString();
  if (s.includes("e")) s = a.toFixed(12);
  const n = numFromString(s);
  return x < 0 ? num(-n.n, n.d) : n;
}

/** Ersetzt Parameter (außer den Variablen in keep) durch ihre Werte als rationale Zahlen. */
export function bindParams(e: Expr, params: Record<string, number>, keep: string[]): { expr: Expr; used: boolean } {
  const map: Record<string, Expr> = {};
  for (const s of freeSymbols(e)) {
    if (!keep.includes(s) && Object.prototype.hasOwnProperty.call(params, s)) map[s] = rationalOf(params[s]);
  }
  return Object.keys(map).length ? { expr: subst(e, map), used: true } : { expr: e, used: false };
}

const close = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * (1 + Math.abs(a));

/**
 * Beweist eine numerisch gefundene Nullstelle: wird der vermutete Ausdruck (rational oder rationales Vielfaches von π)
 * exakt eingesetzt und vereinfacht sich g dabei zu 0, ist er exakt; sonst null.
 */
export function exactRoot(g: Expr, v: string, value: number): Expr | null {
  const c = recognize(value);
  if (!c) return null;
  try {
    const z = simplify(subst(g, { [v]: c }));
    return z.t === "num" && z.n === 0n ? c : null;
  } catch {
    return null;
  }
}

/** Löst lhs = rhs nach v. */
export function solveEquation(lhs: Expr, rhs: Expr, v: string, ctx: Context = {}, range: [number, number] = [-10, 10]): SolveResult {
  const F0 = add(lhs, mul(NEG1, rhs));
  const { expr, used } = bindParams(F0, ctx.params ?? {}, [v]);
  const g = simplify(expr);
  const rf = g.t === "restrict" ? null : (rationalForm(expr, v, false) ?? rationalForm(g, v));
  if (rf) {
    if (polyIsZero(rf.P)) return { all: true, solutions: [], exact: true, method: "polynomial" };
    const rp = solvePolynomial(rf.P);
    const rq = polyDeg(rf.Q) >= 1 ? solvePolynomial(rf.Q) : { all: false, roots: [] };
    const sols: Solution[] = [];
    for (const r of rp.roots) {
      // Nullstellen des Nenners liegen nicht im Definitionsbereich (auch wenn der Zähler dort ebenfalls verschwindet)
      if (rq.roots.some((x) => close(x.value, r.value))) continue;
      sols.push({ value: r.value, expr: r.expr, mult: r.mult });
    }
    const allExact = sols.every((s) => s.expr !== null);
    return {
      all: false,
      solutions: sols,
      exact: allExact && !used,
      method: polyDeg(rf.Q) >= 1 ? "rational" : "polynomial",
      note: !allExact ? "Nullstellen höheren Grades ohne Wurzelausdruck: numerische Näherung" : used ? "Parameter wurden durch ihre aktuellen Werte ersetzt (Näherung)" : undefined,
    };
  }
  const f = compile(g, [v], ctx);
  const roots = scanRoots((x) => f(x), range[0], range[1]);
  return {
    all: false,
    solutions: roots.map((x) => ({ value: x, expr: exactRoot(g, v, x), mult: 1 })),
    exact: false,
    method: "numeric",
    note: `Numerische Suche im Bereich [${range[0]}, ${range[1]}]; weitere Lösungen außerhalb sind möglich`,
  };
}

// ---------- Gleichungssysteme ----------
export interface SystemSolution {
  values: number[];
  exprs: (Expr | null)[];
  exact: boolean;
}
export interface SystemResult {
  /** unique: lineares System; solved: durch Elimination exakt gelöst; numeric: Newton-Verfahren */
  kind: "unique" | "none" | "infinite" | "solved" | "numeric" | "unsupported";
  vars: string[];
  solutions: SystemSolution[];
  note?: string;
}

function solveDense(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

/**
 * Zwei Gleichungen, zwei Unbekannte: Ist eine Gleichung (ggf. nach Addition/Subtraktion beider) in einer Variablen linear,
 * wird sie aufgelöst und in die andere eingesetzt. Die verbleibende Gleichung in einer Variablen löst solveEquation
 * (exakt für Polynome). Beispiele: Kreis ∩ Gerade, Kreis ∩ Kreis, Parabel ∩ Gerade.
 */
function eliminate(F: Expr[], vars: string[], ctx: Context, ranges: [number, number][], used: boolean): SystemResult | null {
  const sets: Expr[][] = [
    [F[0], F[1]],
    [simplify(add(F[0], mul(NEG1, F[1]))), F[1]],
    [simplify(add(F[0], F[1])), F[1]],
  ];
  const resid = (vals: number[]): number => {
    let m = 0;
    for (const f of F) {
      try {
        m = Math.max(m, Math.abs(compile(f, vars, ctx)(...vals)));
      } catch {
        return Infinity;
      }
    }
    return m;
  };
  // eine Linearkombination ist eine von 0 verschiedene Konstante: Widerspruch
  for (const [A] of sets) {
    if (A.t === "num" && A.n !== 0n) return { kind: "none", vars, solutions: [], note: "Das System ist widersprüchlich: keine Lösung" };
  }
  for (const [A, B] of sets) {
    for (const [eqA, eqB] of [[A, B], [B, A]]) {
      for (let j = 0; j < 2; j++) {
        const vj = vars[j];
        const vk = vars[1 - j];
        let c: Expr;
        try {
          c = simplify(derivative(eqA, vj));
        } catch {
          continue;
        }
        if (c.t !== "num" || c.n === 0n) continue;
        const R = simplify(add(eqA, mul(NEG1, c, sym(vj))));
        if (freeSymbols(R).has(vj)) continue;
        const xj = simplify(mul(NEG1, R, num(c.d, c.n))); // vj = −R / c
        const G = simplify(subst(eqB, { [vj]: xj }));
        if (!freeSymbols(G).has(vk)) {
          if (G.t === "num" && G.n !== 0n) return { kind: "none", vars, solutions: [], note: "Das System ist widersprüchlich: keine Lösung" };
          continue;
        }
        let sol;
        try {
          sol = solveEquation(G, ZERO, vk, ctx, ranges[1 - j]);
        } catch {
          continue;
        }
        if (sol.all) continue;
        const fj = compile(xj, [vk], ctx);
        const out: SystemSolution[] = [];
        for (const sv of sol.solutions) {
          const valK = sv.value;
          const valJ = fj(valK);
          if (!Number.isFinite(valJ)) continue;
          const values = j === 0 ? [valJ, valK] : [valK, valJ];
          if (resid(values) > 1e-6 * (1 + Math.max(...values.map(Math.abs)))) continue;
          let eJ: Expr | null = null;
          if (sv.expr) {
            try {
              const cand = expand(subst(xj, { [vk]: sv.expr }));
              if (Number.isFinite(evalNumber(cand))) eJ = cand;
            } catch {
              eJ = null;
            }
          }
          const exprs: (Expr | null)[] = j === 0 ? [eJ, sv.expr] : [sv.expr, eJ];
          out.push({ values, exprs, exact: !used && sv.expr !== null && eJ !== null });
        }
        out.sort((p, q) => p.values[0] - q.values[0] || p.values[1] - q.values[1]);
        const numericOnly = out.some((o) => !o.exact);
        return {
          kind: "solved",
          vars,
          solutions: out,
          note: out.length === 0 ? "Keine reelle Lösung" : numericOnly ? (sol.note ?? "Teils numerische Näherung") : used ? "Parameter wurden durch ihre aktuellen Werte ersetzt (Näherung)" : undefined,
        };
      }
    }
  }
  return null;
}

/** Löst das System F_i = 0 (i = 1..n) in den Variablen vars. */
export function solveSystem(
  eqs: Expr[],
  vars: string[],
  ctx: Context = {},
  range: [number, number] | [number, number][] = [-20, 20]
): SystemResult {
  /** Suchbereich je Variable (ein Bereich gilt für alle) */
  const ranges: [number, number][] = vars.map((_, i) => (Array.isArray(range[0]) ? (range as [number, number][])[i] ?? (range as [number, number][])[0] : (range as [number, number])));
  let anyUsed = false;
  const F = eqs.map((e) => {
    const b = bindParams(e, ctx.params ?? {}, vars);
    anyUsed ||= b.used;
    return simplify(b.expr);
  });
  const n = vars.length;
  const zeroMap: Record<string, Expr> = {};
  vars.forEach((x) => (zeroMap[x] = ZERO));

  // linear?
  const A: Rat[][] = [];
  const bv: Rat[] = [];
  let linear = true;
  for (const f of F) {
    const row: Rat[] = [];
    for (const x of vars) {
      let c: Expr;
      try {
        c = simplify(derivative(f, x));
      } catch {
        linear = false;
        break;
      }
      if (c.t !== "num") {
        linear = false;
        break;
      }
      row.push(rat(c.n, c.d));
    }
    if (!linear) break;
    const k = simplify(subst(f, zeroMap));
    if (k.t !== "num") {
      linear = false;
      break;
    }
    A.push(row);
    bv.push(rat(-k.n, k.d));
  }
  if (linear) {
    const r = solveLinearRat(A, bv);
    if (r.kind === "none") return { kind: "none", vars, solutions: [], note: "Das System ist widersprüchlich: keine Lösung" };
    if (r.kind === "infinite") return { kind: "infinite", vars, solutions: [], note: `Unendlich viele Lösungen (Rang ${r.rank} bei ${n} Unbekannten)` };
    return {
      kind: "unique",
      vars,
      solutions: [{ values: r.x.map(rNum), exprs: r.x.map(rExpr), exact: !anyUsed }],
      note: anyUsed ? "Parameter wurden durch ihre aktuellen Werte ersetzt (Näherung)" : undefined,
    };
  }
  if (n === 2 && F.length === 2) {
    const ex = eliminate(F, vars, ctx, ranges, anyUsed);
    if (ex) return ex;
  }
  if (F.length !== n || n > 3) return { kind: "unsupported", vars, solutions: [], note: "Nichtlineare Systeme werden nur mit genauso vielen Gleichungen wie Unbekannten (höchstens 3) gelöst" };

  // Newton-Verfahren aus einem Startgitter
  const fc = F.map((f) => compile(f, vars, ctx));
  const jac: (((...a: number[]) => number) | null)[][] = F.map((f) =>
    vars.map((x) => {
      try {
        return compile(derivative(f, x), vars, ctx);
      } catch {
        return null;
      }
    })
  );
  const evalF = (p: number[]): number[] => fc.map((f) => f(...p));
  const evalJ = (p: number[]): number[][] =>
    jac.map((row, i) =>
      row.map((g, j) => {
        if (g) return g(...p);
        const h = 1e-6 * Math.max(1, Math.abs(p[j]));
        const q = p.slice();
        q[j] += h;
        return (fc[i](...q) - fc[i](...p)) / h;
      })
    );
  const norm = (v: number[]): number => Math.max(...v.map(Math.abs));
  const per = n === 1 ? 41 : n === 2 ? 17 : 7;
  const found: number[][] = [];
  const idx = new Array<number>(n).fill(0);
  const total = Math.pow(per, n);
  for (let s = 0; s < total; s++) {
    let t = s;
    for (let k = 0; k < n; k++) {
      idx[k] = t % per;
      t = Math.floor(t / per);
    }
    let p = idx.map((i, k) => ranges[k][0] + ((ranges[k][1] - ranges[k][0]) * (i + 0.5)) / per);
    let fp = evalF(p);
    if (!fp.every(Number.isFinite)) continue;
    for (let it = 0; it < 60 && norm(fp) > 1e-13; it++) {
      const J = evalJ(p);
      const step = solveDense(J, fp.map((x) => -x));
      if (!step || !step.every(Number.isFinite)) break;
      let lam = 1;
      let next = p;
      let fn2 = fp;
      for (let k = 0; k < 30; k++) {
        next = p.map((x, i) => x + lam * step[i]);
        fn2 = evalF(next);
        if (fn2.every(Number.isFinite) && norm(fn2) < norm(fp)) break;
        lam /= 2;
      }
      if (!(norm(fn2) < norm(fp))) break;
      p = next;
      fp = fn2;
    }
    if (norm(fp) < 1e-9 && p.every((x) => Math.abs(x) < 1e6)) {
      if (!found.some((q) => q.every((x, i) => Math.abs(x - p[i]) <= 1e-6 * (1 + Math.abs(x))))) found.push(p);
    }
  }
  found.sort((p, q) => p[0] - q[0] || (p[1] ?? 0) - (q[1] ?? 0));
  return {
    kind: "numeric",
    vars,
    solutions: found.map((p) => ({ values: p, exprs: p.map(() => null), exact: false })),
    note: `Numerische Lösung (Newton-Verfahren im Suchbereich ${vars.map((v, k) => `${v} ∈ [${Number(ranges[k][0].toPrecision(4))}, ${Number(ranges[k][1].toPrecision(4))}]`).join(", ")}); weitere Lösungen außerhalb sind möglich`,
  };
}

export { EngineError };
