// Exakte Vereinfachung: rationale Arithmetik (BigInt), Potenzgesetze, Spezialwerte.
import {
  type Expr, type NumE, ZERO, ONE, NEG1, CONSTANTS, num, sym, pow, mul, add, fn, key, mapChildren, subst, EngineError,
} from "./ast.ts";
import { derivative } from "./diff.ts";
import { integralNode } from "./integrate.ts";
import { exactLimit } from "./limits.ts";

type Rat = { n: bigint; d: bigint };

// ---------- rationale Hilfsfunktionen ----------
function gcdB(a: bigint, b: bigint): bigint {
  if (a < 0n) a = -a;
  if (b < 0n) b = -b;
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}
function rNorm(n: bigint, d: bigint): Rat {
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcdB(n, d);
  return g > 1n ? { n: n / g, d: d / g } : { n, d };
}
const rAdd = (a: Rat, b: Rat): Rat => rNorm(a.n * b.d + b.n * a.d, a.d * b.d);
const rMul = (a: Rat, b: Rat): Rat => rNorm(a.n * b.n, a.d * b.d);
const rExpr = (r: Rat): NumE => ({ t: "num", n: r.n, d: r.d });

function rPowInt(r: Rat, k: bigint): Rat | null {
  if (k >= 0n) return { n: r.n ** k, d: r.d ** k };
  if (r.n === 0n) return null;
  return rNorm(r.d ** -k, r.n ** -k);
}

function intRoot(n: bigint, k: number): bigint | null {
  if (n < 2n) return n;
  const K = BigInt(k);
  let lo = 1n;
  let hi = 1n << BigInt(Math.ceil(n.toString(2).length / k) + 1);
  while (lo < hi) {
    const mid = (lo + hi) >> 1n;
    const p = mid ** K;
    if (p === n) return mid;
    if (p < n) lo = mid + 1n;
    else hi = mid;
  }
  return lo ** K === n ? lo : null;
}

/** n = a²·b mit möglichst großem a (nur für kleine n). */
function squareSplit(n: bigint): [bigint, bigint] {
  if (n > 1_000_000_000n) return [1n, n];
  let a = 1n;
  let rest = n;
  for (let i = 2n; i * i <= rest; i++) {
    while (rest % (i * i) === 0n) {
      a *= i;
      rest /= i * i;
    }
  }
  return [a, rest];
}

function exactPow(base: NumE, exp: NumE): Expr | null {
  if (exp.d === 1n) {
    const k = exp.n;
    if (k > 4000n || k < -4000n) return null;
    const r = rPowInt(base, k);
    return r ? rExpr(r) : null;
  }
  if (exp.d > 64n) return null;
  const q = Number(exp.d);
  const p = exp.n;
  let b: Rat = base;
  let negate = false;
  if (b.n < 0n) {
    if (q % 2 === 0) return null;
    negate = p % 2n !== 0n;
    b = { n: -b.n, d: b.d };
  }
  const rn = intRoot(b.n, q);
  const rd = intRoot(b.d, q);
  if (rn !== null && rd !== null) {
    const rp = rPowInt(rNorm(rn, rd), p);
    if (!rp) return null;
    return rExpr(negate ? { n: -rp.n, d: rp.d } : rp);
  }
  if (q === 2 && b.d === 1n && p > 0n && !negate) {
    const [a, rest] = squareSplit(b.n);
    const m = (p - 1n) / 2n;
    if (a > 1n || m > 0n) {
      const coeff = rMul(rPowInt({ n: b.n, d: 1n }, m) as Rat, { n: a, d: 1n });
      return sMul([rExpr(coeff), pow(num(rest), num(1, 2))]);
    }
  }
  return null;
}

// ---------- Sortierung ----------
function degreeOf(e: Expr): number {
  switch (e.t) {
    case "sym":
      return CONSTANTS.has(e.name) ? 0 : 1;
    case "pow":
      return e.base.t === "sym" && !CONSTANTS.has(e.base.name) && e.exp.t === "num" ? Number(e.exp.n) / Number(e.exp.d) : 0;
    case "mul":
      return e.args.reduce((s, a) => s + degreeOf(a), 0);
    default:
      return 0;
  }
}
function cmpAdd(a: Expr, b: Expr): number {
  if (a.t === "num") return 1;
  if (b.t === "num") return -1;
  const da = degreeOf(a);
  const db = degreeOf(b);
  if (da !== db) return db - da;
  // bei gleichem Grad nach dem Term ohne Zahlenfaktor ordnen (a, b, c statt „−a“ hinter „c“)
  const body = (e: Expr): string => (e.t === "mul" && e.args[0].t === "num" ? key(e.args.length === 2 ? e.args[1] : { t: "mul", args: e.args.slice(1) }) : key(e));
  const ka = body(a);
  const kb = body(b);
  if (ka !== kb) return ka < kb ? -1 : 1;
  const fa = key(a);
  const fb = key(b);
  return fa < fb ? -1 : fa > fb ? 1 : 0;
}
function rankMul(e: Expr): [number, string] {
  if (e.t === "pow" && e.base.t === "sym" && e.base.name === "e" && e.exp.t !== "num") return [2, "e" + key(e)];
  const b = e.t === "pow" ? e.base : e;
  if (b.t === "sym") return [CONSTANTS.has(b.name) ? 0 : 1, b.name];
  if (b.t === "fn") return [2, key(b)];
  if (b.t === "add") return [3, key(b)];
  return [4, key(b)];
}
function cmpMul(a: Expr, b: Expr): number {
  const [ra, sa] = rankMul(a);
  const [rb, sb] = rankMul(b);
  if (ra !== rb) return ra - rb;
  if (sa !== sb) return sa < sb ? -1 : 1;
  const ka = key(a);
  const kb = key(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

// ---------- Summe / Produkt / Potenz ----------
export function sAdd(input: Expr[]): Expr {
  let c: Rat = { n: 0n, d: 1n };
  const terms = new Map<string, { rest: Expr; coeff: Rat }>();
  const stack = [...input];
  while (stack.length) {
    const a = stack.pop() as Expr;
    if (a.t === "add") {
      stack.push(...a.args);
      continue;
    }
    if (a.t === "num") {
      c = rAdd(c, a);
      continue;
    }
    // Zahl · (Summe) innerhalb einer Summe ausmultiplizieren, damit sich gleiche Terme aufheben: x − (x + 1) = −1
    if (a.t === "mul") {
      const nums = a.args.filter((x) => x.t === "num");
      const rest = a.args.filter((x) => x.t !== "num");
      if (nums.length >= 1 && rest.length === 1 && rest[0].t === "add") {
        const k = sMul(nums);
        for (const t of rest[0].args) stack.push(sMul([k, t]));
        continue;
      }
    }
    let coeff: Rat = { n: 1n, d: 1n };
    let rest: Expr = a;
    if (a.t === "mul") {
      const first = a.args[0];
      if (first.t === "num") {
        coeff = first;
        const r = a.args.slice(1);
        rest = r.length === 1 ? r[0] : { t: "mul", args: r };
      }
    }
    const k = key(rest);
    const t = terms.get(k);
    if (t) t.coeff = rAdd(t.coeff, coeff);
    else terms.set(k, { rest, coeff });
  }
  const out: Expr[] = [];
  for (const { rest, coeff } of terms.values()) {
    if (coeff.n === 0n) continue;
    out.push(coeff.n === 1n && coeff.d === 1n ? rest : sMul([rExpr(coeff), rest]));
  }
  out.sort(cmpAdd);
  if (c.n !== 0n) out.push(rExpr(c));
  if (out.length === 0) return ZERO;
  if (out.length === 1) return out[0];
  return { t: "add", args: out };
}

export function sMul(input: Expr[], depth = 0): Expr {
  let coeff: Rat = { n: 1n, d: 1n };
  const groups = new Map<string, { base: Expr; exps: Expr[] }>();
  const stack = [...input];
  while (stack.length) {
    const a = stack.pop() as Expr;
    if (a.t === "mul") {
      stack.push(...a.args);
      continue;
    }
    if (a.t === "num") {
      coeff = rMul(coeff, a);
      continue;
    }
    const base = a.t === "pow" ? a.base : a;
    const exp = a.t === "pow" ? a.exp : ONE;
    const k = key(base);
    const g = groups.get(k);
    if (g) g.exps.push(exp);
    else groups.set(k, { base, exps: [exp] });
  }
  if (coeff.n === 0n) return ZERO;
  const out: Expr[] = [];
  const pending: Expr[] = [];
  for (const { base, exps } of groups.values()) {
    const p = sPow(base, exps.length === 1 ? exps[0] : sAdd(exps));
    if (p.t === "num") coeff = rMul(coeff, p);
    else if (p.t === "mul") pending.push(p);
    else out.push(p);
  }
  if (pending.length && depth < 6) return sMul([rExpr(coeff), ...out, ...pending], depth + 1);
  if (coeff.n === 0n) return ZERO;
  out.push(...pending);
  out.sort(cmpMul);
  if (out.length === 0) return rExpr(coeff);
  const isOne = coeff.n === 1n && coeff.d === 1n;
  if (isOne && out.length === 1) return out[0];
  return { t: "mul", args: isOne ? out : [rExpr(coeff), ...out] };
}

export function sPow(b: Expr, e: Expr): Expr {
  if (e.t === "num") {
    if (e.n === 0n) return ONE;
    if (e.n === 1n && e.d === 1n) return b;
  }
  if (b.t === "num") {
    if (b.n === 1n && b.d === 1n) return ONE;
    if (b.n === 0n && e.t === "num" && e.n > 0n) return ZERO;
    if (e.t === "num") {
      const r = exactPow(b, e);
      if (r) return r;
    }
  }
  if (b.t === "pow" && e.t === "num" && e.d === 1n) return sPow(b.base, sMul([b.exp, e]));
  if (b.t === "mul" && e.t === "num" && e.d === 1n) return sMul(b.args.map((a) => sPow(a, e)));
  if (b.t === "sym" && b.name === "e" && e.t === "fn" && e.name === "ln") return e.args[0];
  return { t: "pow", base: b, exp: e };
}

export const neg = (e: Expr): Expr => sMul([NEG1, e]);

// ---------- Funktionen: exakte Spezialwerte ----------
function piMultiple(a: Expr): Rat | null {
  if (a.t === "num" && a.n === 0n) return { n: 0n, d: 1n };
  if (a.t === "sym" && a.name === "pi") return { n: 1n, d: 1n };
  if (a.t === "mul" && a.args.length === 2) {
    const [c, p] = a.args;
    if (c.t === "num" && p.t === "sym" && p.name === "pi") return c;
  }
  return null;
}

/** sin(k·π/12) exakt für k ∈ {0,2,3,4,6} (mod Symmetrien), sonst null. */
function sinTwelfths(k0: bigint): Expr | null {
  let k = Number(((k0 % 24n) + 24n) % 24n);
  let sign = 1;
  if (k > 12) {
    k -= 12;
    sign = -1;
  }
  if (k > 6) k = 12 - k;
  let v: Expr;
  switch (k) {
    case 0: v = ZERO; break;
    case 2: v = num(1, 2); break;
    case 3: v = sMul([num(1, 2), pow(num(2), num(1, 2))]); break;
    case 4: v = sMul([num(1, 2), pow(num(3), num(1, 2))]); break;
    case 6: v = ONE; break;
    default: return null;
  }
  return sign === 1 ? v : neg(v);
}

function trigExact(name: string, arg: Expr): Expr | null {
  const r = piMultiple(arg);
  if (!r) return null;
  if ((r.n * 12n) % r.d !== 0n) return null;
  const k = (r.n * 12n) / r.d;
  if (name === "sin") return sinTwelfths(k);
  if (name === "cos") return sinTwelfths(k + 6n);
  const s = sinTwelfths(k);
  const c = sinTwelfths(k + 6n);
  if (!s || !c || (c.t === "num" && c.n === 0n)) return null;
  return sMul([s, sPow(c, NEG1)]);
}

const PI: Expr = sym("pi");
function inverseExact(name: string, a: Expr): Expr | null {
  if (a.t !== "num") return null;
  const v = a.d === 1n ? a.n.toString() : `${a.n}/${a.d}`;
  const pi = (n: number, d: number): Expr => sMul([num(n, d), PI]);
  if (name === "arcsin") {
    const t: Record<string, Expr> = { "0": ZERO, "1/2": pi(1, 6), "1": pi(1, 2), "-1/2": pi(-1, 6), "-1": pi(-1, 2) };
    return t[v] ?? null;
  }
  if (name === "arccos") {
    const t: Record<string, Expr> = { "1": ZERO, "1/2": pi(1, 3), "0": pi(1, 2), "-1/2": pi(2, 3), "-1": PI };
    return t[v] ?? null;
  }
  if (name === "arctan") {
    const t: Record<string, Expr> = { "0": ZERO, "1": pi(1, 4), "-1": pi(-1, 4) };
    return t[v] ?? null;
  }
  return null;
}

export function sFn(name: string, args: Expr[]): Expr {
  const a = args[0];
  if (args.length === 1 && a !== undefined) {
    if (a.t === "num") {
      const floorDiv = (n: bigint, d: bigint): bigint => n / d - (n % d !== 0n && n < 0n ? 1n : 0n);
      const flo = floorDiv(a.n, a.d);
      switch (name) {
        case "abs": return rExpr({ n: a.n < 0n ? -a.n : a.n, d: a.d });
        case "sign": return num(a.n > 0n ? 1 : a.n < 0n ? -1 : 0);
        case "floor": return num(flo);
        case "ceil": return num(a.d === 1n ? a.n : flo + 1n);
        case "round": return num(floorDiv(2n * a.n + a.d, 2n * a.d));
        case "fact":
          if (a.d === 1n && a.n >= 0n && a.n <= 400n) {
            let r = 1n;
            for (let i = 2n; i <= a.n; i++) r *= i;
            return num(r);
          }
          break;
        case "ln":
          if (a.n === 1n && a.d === 1n) return ZERO;
          break;
        case "sin": case "tan": case "arctan": case "sinh": case "tanh": case "arcsin":
          if (a.n === 0n) return ZERO;
          break;
        case "cos": case "cosh":
          if (a.n === 0n) return ONE;
          break;
      }
    }
    if (name === "abs" && a.t === "sym" && (a.name === "e" || a.name === "pi" || a.name === "tau")) return a;
    if (name === "ln") {
      if (a.t === "sym" && a.name === "e") return ONE;
      if (a.t === "pow" && a.base.t === "sym" && a.base.name === "e") return a.exp;
    }
    if (name === "sin" || name === "cos" || name === "tan") {
      const r = trigExact(name, a);
      if (r) return r;
    }
    if (name === "arcsin" || name === "arccos" || name === "arctan") {
      const r = inverseExact(name, a);
      if (r) return r;
    }
    if (name === "abs" && a.t === "mul" && a.args[0].t === "num") {
      const c = a.args[0];
      const rest = a.args.slice(1);
      if (c.n < 0n) return sMul([rExpr({ n: -c.n, d: c.d }), fn("abs", rest.length === 1 ? rest[0] : { t: "mul", args: rest })]);
    }
  }
  if ((name === "min" || name === "max") && args.every((x) => x.t === "num")) {
    const nums = args as NumE[];
    const cmp = (x: NumE, y: NumE) => Number(x.n * y.d - y.n * x.d > 0n) - Number(x.n * y.d - y.n * x.d < 0n);
    return nums.reduce((m, x) => ((name === "min" ? cmp(x, m) < 0 : cmp(x, m) > 0) ? x : m));
  }
  return { t: "fn", name, args };
}

// ---------- Hauptfunktion ----------
export function simplify(e: Expr): Expr {
  switch (e.t) {
    case "num":
    case "sym":
      return e;
    case "add":
      return sAdd(e.args.map(simplify));
    case "mul":
      return sMul(e.args.map(simplify));
    case "pow":
      return sPow(simplify(e.base), simplify(e.exp));
    case "fn":
      return sFn(e.name, e.args.map(simplify));
    case "sum":
    case "prod": {
      const from = simplify(e.from);
      const to = simplify(e.to);
      const body = simplify(e.body);
      if (from.t === "num" && to.t === "num" && from.d === 1n && to.d === 1n) {
        if (to.n - from.n > 100000n) throw new EngineError("Summe/Produkt hat zu viele Glieder (max. 100000)");
        const terms: Expr[] = [];
        for (let k = from.n; k <= to.n; k++) terms.push(simplify(subst(body, { [e.v]: num(k) })));
        return e.t === "sum" ? sAdd(terms) : sMul(terms);
      }
      return { t: e.t, v: e.v, from, to, body };
    }
    case "diff":
      return derivative(e.body, e.v, e.order);
    case "lim": {
      const node = mapChildren(e, simplify) as Extract<Expr, { t: "lim" }>;
      return exactLimit(node.body, node.v, node.to, node.dir) ?? node;
    }
    case "int": {
      const node = mapChildren(e, simplify) as Extract<Expr, { t: "int" }>;
      return integralNode(node) ?? node;
    }
    case "def":
      return { t: "def", name: e.name, params: e.params, body: simplify(e.body) };
    default:
      return mapChildren(e, simplify);
  }
}

function sAddTerms(terms: Expr[]): Expr[] {
  const r = sAdd(terms);
  return r.t === "add" ? r.args : [r];
}

/** Multipliziert Klammern aus und entwickelt ganzzahlige Potenzen von Summen. */
export function expand(e0: Expr, intoFunctions = true): Expr {
  const e = simplify(e0);
  const go = (x: Expr): Expr => {
    switch (x.t) {
      case "add":
        return sAdd(x.args.map(go));
      case "mul": {
        let terms: Expr[][] = [[]];
        for (const a of x.args) {
          const ea = go(a);
          const parts = ea.t === "add" ? ea.args : [ea];
          terms = terms.flatMap((t) => parts.map((p) => [...t, p]));
          if (terms.length > 5000) throw new EngineError("Ausdruck wird beim Ausmultiplizieren zu groß");
        }
        return sAdd(terms.map((t) => sMul(t)));
      }
      case "pow": {
        const b = go(x.base);
        if (b.t === "add" && x.exp.t === "num" && x.exp.d === 1n && x.exp.n >= 2n && x.exp.n <= 50n) {
          // Term für Term ausmultiplizieren (sMul würde (b)(b) sofort wieder zu b^2 zusammenfassen)
          const parts = b.args;
          let r: Expr[] = parts;
          for (let i = 1n; i < x.exp.n; i++) {
            if (r.length * parts.length > 20000) throw new EngineError("Potenz wird beim Ausmultiplizieren zu groß");
            r = sAddTerms(r.flatMap((p) => parts.map((q) => sMul([p, q]))));
          }
          return sAdd(r);
        }
        return sPow(b, go(x.exp));
      }
      case "fn":
        return intoFunctions ? sFn(x.name, x.args.map(go)) : x;
      default:
        return x;
    }
  };
  return go(e);
}

export { mul, add };
