// Numerische Auswertung: AST -> Closure-Baum (kein eval, kein new Function).
import {
  type Expr, type DefInfo, EngineError, UndefinedSymbolError, inlineDefs,
} from "./ast.ts";
import { derivative } from "./diff.ts";

export interface Context {
  params?: Record<string, number>;
  defs?: Record<string, DefInfo>;
}
type F = (a: number[]) => number;
type B = (a: number[]) => boolean;

const CONST_VALUES: Record<string, number> = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI, infty: Infinity };
const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

export function realPow(b: number, e: number): number {
  if (b < 0 && !Number.isInteger(e)) {
    for (let q = 3; q <= 99; q += 2) {
      const p = e * q;
      const r = Math.round(p);
      if (Math.abs(p - r) < 1e-9 * Math.max(1, Math.abs(p))) return (r % 2 === 0 ? 1 : -1) * Math.pow(-b, e);
    }
    return NaN;
  }
  return Math.pow(b, e);
}

function gamma(z: number): number {
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  z -= 1;
  const C = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  let x = C[0];
  for (let i = 1; i < 9; i++) x += C[i] / (z + i);
  const t = z + 7.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}
export function factorial(x: number): number {
  if (Number.isInteger(x)) {
    if (x < 0) return NaN;
    if (x > 170) return Infinity;
    let r = 1;
    for (let i = 2; i <= x; i++) r *= i;
    return r;
  }
  return gamma(x + 1);
}

const FNS: Record<string, (...x: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, cot: (x) => 1 / Math.tan(x),
  arcsin: Math.asin, arccos: Math.acos, arctan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  ln: Math.log, abs: Math.abs, floor: Math.floor, ceil: Math.ceil,
  round: (x) => Math.floor(x + 0.5), sign: Math.sign, fact: factorial,
  min: (...x) => Math.min(...x), max: (...x) => Math.max(...x),
};

// ---------- Integration (adaptives Gauß–Kronrod G7K15) ----------
const XGK = [0.991455371120812639206854697526329, 0.949107912342758524526189684047851, 0.864864423359769072789712788640926, 0.741531185599394439863864773280788, 0.58608723546769113029414483825873, 0.405845151377397166906606412076961, 0.207784955007898467600689403773245, 0];
const WGK = [0.02293532201052922496373200805897, 0.063092092629978553290700663189204, 0.104790010322250183839876322541518, 0.140653259715525918745189590510238, 0.16900472663926790282658342659855, 0.190350578064785409913256402421014, 0.204432940075298892414161999234649, 0.209482141084727828012999174891714];
const WG = [0.129484966168869693270611432679082, 0.27970539148927666790146777142378, 0.381830050505118944950369775488975, 0.417959183673469387755102040816327];

function gk15(f: (x: number) => number, a: number, b: number): [number, number] {
  const c = (a + b) / 2;
  const h = (b - a) / 2;
  const fc = f(c);
  let rk = fc * WGK[7];
  let rg = fc * WG[3];
  for (let j = 0; j < 7; j++) {
    const dx = h * XGK[j];
    const s = f(c - dx) + f(c + dx);
    rk += WGK[j] * s;
    if (j % 2 === 1) rg += WG[(j - 1) / 2] * s;
  }
  return [rk * h, rg * h];
}

export interface IntegralResult {
  value: number;
  error: number;
}

export function integrate(f: (x: number) => number, a: number, b: number, tol = 1e-10): IntegralResult {
  if (Number.isNaN(a) || Number.isNaN(b)) return { value: NaN, error: NaN };
  if (a === b) return { value: 0, error: 0 };
  if (a > b) {
    const r = integrate(f, b, a, tol);
    return { value: -r.value, error: r.error };
  }
  if (a === -Infinity && b === Infinity) {
    return integrate((t) => {
      const w = 1 - t * t;
      return f(t / w) * ((1 + t * t) / (w * w));
    }, -1, 1, tol);
  }
  if (b === Infinity) return integrate((t) => f(a + t / (1 - t)) / ((1 - t) * (1 - t)), 0, 1, tol);
  if (a === -Infinity) return integrate((u) => f(b - u), 0, Infinity, tol);
  const budget = { n: 0, err: 0 };
  const rec = (lo: number, hi: number, depth: number): number => {
    const [k, g] = gk15(f, lo, hi);
    budget.n += 15;
    const err = Math.abs(k - g);
    if (!Number.isFinite(k)) return k;
    if (err <= tol * Math.max(1, Math.abs(k)) || depth >= 45 || budget.n > 400000) {
      budget.err += err;
      return k;
    }
    const m = (lo + hi) / 2;
    return rec(lo, m, depth + 1) + rec(m, hi, depth + 1);
  };
  return { value: rec(a, b, 0), error: budget.err };
}

/** Numerischer Grenzwert (Näherung). dir: "" zweiseitig, "+" von rechts, "-" von links. */
export function limitNumeric(f: (x: number) => number, to: number, dir: "" | "+" | "-"): number {
  if (!Number.isFinite(to)) {
    const s = to > 0 ? 1 : -1;
    const v1 = f(s * 1e6);
    const v2 = f(s * 1e8);
    if (Math.abs(v2) > 1e6 && Math.abs(v2) > 2 * Math.abs(v1)) return Math.sign(v2) * Infinity;
    return Math.abs(v2 - v1) <= 1e-4 * (1 + Math.abs(v2)) ? v2 : NaN;
  }
  const h = 1e-4;
  const one = (s: number): number => 2 * f(to + (s * h) / 2) - f(to + s * h);
  if (dir === "+") return one(1);
  if (dir === "-") return one(-1);
  const r = f(to + h);
  const l = f(to - h);
  if (Math.abs(r - l) > 1e-3 * (1 + Math.abs(r) + Math.abs(l))) {
    if (Math.abs(r) > 1e6 && Math.abs(l) > 1e6 && Math.sign(r) === Math.sign(l)) return Math.sign(r) * Infinity;
    return NaN;
  }
  return (r + l) / 2;
}

// ---------- Compiler ----------
function c(e: Expr, vars: string[], ctx: Context, stack: string[]): F {
  switch (e.t) {
    case "num": {
      const v = Number(e.n) / Number(e.d);
      return () => v;
    }
    case "sym": {
      const i = vars.lastIndexOf(e.name);
      if (i >= 0) return (a) => a[i];
      if (ctx.params && has(ctx.params, e.name)) {
        const v = ctx.params[e.name];
        return () => v;
      }
      if (has(CONST_VALUES, e.name)) {
        const v = CONST_VALUES[e.name];
        return () => v;
      }
      throw new UndefinedSymbolError(e.name);
    }
    case "add": {
      const fs = e.args.map((x) => c(x, vars, ctx, stack));
      if (fs.length === 2) {
        const [f, g] = fs;
        return (a) => f(a) + g(a);
      }
      return (a) => {
        let s = 0;
        for (const f of fs) s += f(a);
        return s;
      };
    }
    case "mul": {
      const fs = e.args.map((x) => c(x, vars, ctx, stack));
      if (fs.length === 2) {
        const [f, g] = fs;
        return (a) => f(a) * g(a);
      }
      return (a) => {
        let s = 1;
        for (const f of fs) s *= f(a);
        return s;
      };
    }
    case "pow": {
      const bf = c(e.base, vars, ctx, stack);
      if (e.exp.t === "num" && e.exp.d === 1n && e.exp.n === 2n) return (a) => { const x = bf(a); return x * x; };
      const ef = c(e.exp, vars, ctx, stack);
      return (a) => realPow(bf(a), ef(a));
    }
    case "fn": {
      if (ctx.defs && has(ctx.defs, e.name)) {
        if (stack.includes(e.name)) throw new EngineError(`Rekursive Definition von ${e.name}`, "recursion");
        const def = ctx.defs[e.name];
        if (def.params.length !== e.args.length) throw new EngineError(`Funktion ${e.name} erwartet ${def.params.length} Argument(e)`, "arity");
        const argf = e.args.map((x) => c(x, vars, ctx, stack));
        const body = c(def.body, def.params, ctx, [...stack, e.name]);
        return (a) => body(argf.map((f) => f(a)));
      }
      if (!has(FNS, e.name)) throw new EngineError(`Unbekannte Funktion: ${e.name}`, "unknown-function");
      const fnc = FNS[e.name];
      const fs = e.args.map((x) => c(x, vars, ctx, stack));
      if (fs.length === 1) {
        const f = fs[0];
        return (a) => fnc(f(a));
      }
      return (a) => fnc(...fs.map((f) => f(a)));
    }
    case "sum":
    case "prod": {
      const idx = vars.length;
      const lo = c(e.from, vars, ctx, stack);
      const hi = c(e.to, vars, ctx, stack);
      const body = c(e.body, [...vars, e.v], ctx, stack);
      const isSum = e.t === "sum";
      return (a) => {
        const l = Math.round(lo(a));
        const h = Math.round(hi(a));
        if (!Number.isFinite(l) || !Number.isFinite(h) || h - l > 1e7) return NaN;
        const b = a.slice(0, idx);
        let acc = isSum ? 0 : 1;
        for (let k = l; k <= h; k++) {
          b[idx] = k;
          acc = isSum ? acc + body(b) : acc * body(b);
        }
        return acc;
      };
    }
    case "int": {
      if (!e.from || !e.to) throw new EngineError("Unbestimmtes Integral kann nicht numerisch ausgewertet werden", "indefinite");
      const idx = vars.length;
      const lo = c(e.from, vars, ctx, stack);
      const hi = c(e.to, vars, ctx, stack);
      const body = c(e.body, [...vars, e.v], ctx, stack);
      return (a) => {
        const b = a.slice(0, idx);
        return integrate((x) => ((b[idx] = x), body(b)), lo(a), hi(a)).value;
      };
    }
    case "lim": {
      const idx = vars.length;
      const to = c(e.to, vars, ctx, stack);
      const body = c(e.body, [...vars, e.v], ctx, stack);
      return (a) => {
        const b = a.slice(0, idx);
        return limitNumeric((x) => ((b[idx] = x), body(b)), to(a), e.dir);
      };
    }
    case "diff": {
      const body = ctx.defs ? inlineDefs(e.body, ctx.defs) : e.body;
      return c(derivative(body, e.v, e.order), vars, ctx, stack);
    }
    case "cases": {
      const rows = e.rows.map((r) => ({
        cond: r.cond ? cb(r.cond, vars, ctx, stack) : null,
        value: c(r.value, vars, ctx, stack),
      }));
      return (a) => {
        for (const r of rows) if (!r.cond || r.cond(a)) return r.value(a);
        return NaN;
      };
    }
    case "rel":
      throw new EngineError("Eine Relation hat keinen Zahlenwert (nur Wahrheitswert)", "not-numeric");
    default:
      throw new EngineError(`„${e.t}“ kann nicht numerisch ausgewertet werden`, "not-numeric");
  }
}

function cb(e: Expr, vars: string[], ctx: Context, stack: string[]): B {
  if (e.t !== "rel") throw new EngineError("Bedingung muss eine Relation sein (z. B. x \\geq 0)", "not-boolean");
  const fs = e.args.map((x) => c(x, vars, ctx, stack));
  const ops = e.ops;
  const test = (op: string, x: number, y: number): boolean => {
    switch (op) {
      case "=": return Math.abs(x - y) <= 1e-12 * Math.max(1, Math.abs(x), Math.abs(y));
      case "<": return x < y;
      case ">": return x > y;
      case "<=": return x <= y;
      case ">=": return x >= y;
      default: return x !== y;
    }
  };
  return (a) => {
    let prev = fs[0](a);
    for (let i = 0; i < ops.length; i++) {
      const cur = fs[i + 1](a);
      if (!test(ops[i], prev, cur)) return false;
      prev = cur;
    }
    return true;
  };
}

/** Kompiliert einen Ausdruck zu einer schnellen Funktion der angegebenen Variablen. */
export function compile(e: Expr, vars: string[] = [], ctx: Context = {}): (...args: number[]) => number {
  const f = c(e, vars, ctx, []);
  const n = vars.length;
  return (...args: number[]) => f(args.length === n ? args : args.slice(0, n));
}

/** Kompiliert eine Bedingung (Relation) zu einem Prädikat, z. B. für Ungleichungen. */
export function compileRelation(e: Expr, vars: string[] = [], ctx: Context = {}): (...args: number[]) => boolean {
  const f = cb(e, vars, ctx, []);
  return (...args: number[]) => f(args);
}

export function evalNumber(e: Expr, params: Record<string, number> = {}, defs?: Record<string, DefInfo>): number {
  return compile(e, [], { params, defs })();
}
