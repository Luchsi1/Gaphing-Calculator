// Interne mathematische Darstellung (AST). Zahlen sind exakte rationale Zahlen (BigInt).

export type Expr =
  | { t: "num"; n: bigint; d: bigint }
  | { t: "sym"; name: string }
  | { t: "add"; args: Expr[] }
  | { t: "mul"; args: Expr[] }
  | { t: "pow"; base: Expr; exp: Expr }
  | { t: "fn"; name: string; args: Expr[] }
  | { t: "sum" | "prod"; v: string; from: Expr; to: Expr; body: Expr }
  | { t: "int"; v: string; from: Expr | null; to: Expr | null; body: Expr }
  | { t: "diff"; v: string; order: number; body: Expr }
  | { t: "lim"; v: string; to: Expr; dir: "" | "+" | "-"; body: Expr }
  | { t: "rel"; ops: string[]; args: Expr[] }
  | { t: "cases"; rows: { value: Expr; cond: Expr | null }[] }
  | { t: "matrix"; rows: Expr[][]; delim: "p" | "b" | "v" | "" }
  | { t: "tuple"; items: Expr[] }
  | { t: "def"; name: string; params: string[]; body: Expr }
  | { t: "restrict"; body: Expr; cond: Expr };

export type NumE = Extract<Expr, { t: "num" }>;

export class EngineError extends Error {
  kind: string;
  constructor(message: string, kind = "engine") {
    super(message);
    this.name = "EngineError";
    this.kind = kind;
  }
}

export class UndefinedSymbolError extends EngineError {
  symbol: string;
  constructor(symbol: string) {
    super(`Undefinierte Variable: ${symbol}`, "undefined-symbol");
    this.symbol = symbol;
  }
}

export const CONSTANTS = new Set(["pi", "e", "tau", "infty"]);

export const GREEK = new Set([
  "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta", "vartheta",
  "iota", "kappa", "lambda", "mu", "nu", "xi", "pi", "rho", "sigma", "tau", "upsilon", "phi",
  "varphi", "chi", "psi", "omega", "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma",
  "Phi", "Psi", "Omega",
]);

export function gcd(a: bigint, b: bigint): bigint {
  if (a < 0n) a = -a;
  if (b < 0n) b = -b;
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

export function num(n: bigint | number, d: bigint | number = 1n): NumE {
  let nn = BigInt(n);
  let dd = BigInt(d);
  if (dd === 0n) throw new EngineError("Division durch null", "division-by-zero");
  if (dd < 0n) {
    nn = -nn;
    dd = -dd;
  }
  const g = gcd(nn, dd);
  if (g > 1n) {
    nn /= g;
    dd /= g;
  }
  return { t: "num", n: nn, d: dd };
}

export const ZERO = num(0);
export const ONE = num(1);
export const NEG1 = num(-1);

export const sym = (name: string): Expr => ({ t: "sym", name });
export const add = (...args: Expr[]): Expr => ({ t: "add", args });
export const mul = (...args: Expr[]): Expr => ({ t: "mul", args });
export const pow = (base: Expr, exp: Expr): Expr => ({ t: "pow", base, exp });
export const fn = (name: string, ...args: Expr[]): Expr => ({ t: "fn", name, args });

export const isInt = (e: Expr): e is NumE => e.t === "num" && e.d === 1n;

export function numberOf(e: NumE): number {
  return Number(e.n) / Number(e.d);
}

export function numFromString(s: string): NumE {
  const dot = s.indexOf(".");
  if (dot < 0) return num(BigInt(s));
  const frac = s.slice(dot + 1);
  const digits = s.slice(0, dot) + frac;
  return num(BigInt(digits === "" ? "0" : digits), 10n ** BigInt(frac.length));
}

const replacer = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() + "n" : v);

/** Kanonischer String-Schlüssel (für Gleichheit und Sortierung). */
export function key(e: Expr): string {
  if (e.t === "num") return e.d === 1n ? e.n.toString() : `${e.n}/${e.d}`;
  if (e.t === "sym") return e.name;
  return JSON.stringify(e, replacer);
}

export const equal = (a: Expr, b: Expr): boolean => key(a) === key(b);

export function mapChildren(e: Expr, f: (c: Expr) => Expr): Expr {
  switch (e.t) {
    case "num":
    case "sym":
      return e;
    case "add":
      return { t: "add", args: e.args.map(f) };
    case "mul":
      return { t: "mul", args: e.args.map(f) };
    case "pow":
      return { t: "pow", base: f(e.base), exp: f(e.exp) };
    case "fn":
      return { t: "fn", name: e.name, args: e.args.map(f) };
    case "sum":
      return { t: "sum", v: e.v, from: f(e.from), to: f(e.to), body: f(e.body) };
    case "prod":
      return { t: "prod", v: e.v, from: f(e.from), to: f(e.to), body: f(e.body) };
    case "int":
      return { t: "int", v: e.v, from: e.from && f(e.from), to: e.to && f(e.to), body: f(e.body) };
    case "diff":
      return { t: "diff", v: e.v, order: e.order, body: f(e.body) };
    case "lim":
      return { t: "lim", v: e.v, to: f(e.to), dir: e.dir, body: f(e.body) };
    case "rel":
      return { t: "rel", ops: e.ops, args: e.args.map(f) };
    case "cases":
      return { t: "cases", rows: e.rows.map((r) => ({ value: f(r.value), cond: r.cond && f(r.cond) })) };
    case "matrix":
      return { t: "matrix", rows: e.rows.map((r) => r.map(f)), delim: e.delim };
    case "tuple":
      return { t: "tuple", items: e.items.map(f) };
    case "def":
      return { t: "def", name: e.name, params: e.params, body: f(e.body) };
    case "restrict":
      return { t: "restrict", body: f(e.body), cond: f(e.cond) };
  }
}

function without(map: Record<string, Expr>, v: string): Record<string, Expr> {
  if (!Object.prototype.hasOwnProperty.call(map, v)) return map;
  const m = { ...map };
  delete m[v];
  return m;
}

/** Ersetzt freie Symbole gleichzeitig (gebundene Variablen bleiben unberührt). */
export function subst(e: Expr, map: Record<string, Expr>): Expr {
  switch (e.t) {
    case "sym": {
      if (Object.prototype.hasOwnProperty.call(map, e.name)) return map[e.name];
      const us = e.name.indexOf("_");
      if (us > 0) {
        const r = map[e.name.slice(us + 1)];
        if (r && r.t === "num" && r.d === 1n) return sym(e.name.slice(0, us) + "_" + r.n.toString());
      }
      return e;
    }
    case "sum":
    case "prod":
      return { t: e.t, v: e.v, from: subst(e.from, map), to: subst(e.to, map), body: subst(e.body, without(map, e.v)) };
    case "int":
      return {
        t: "int", v: e.v,
        from: e.from && subst(e.from, map), to: e.to && subst(e.to, map),
        body: subst(e.body, without(map, e.v)),
      };
    case "lim":
      return { t: "lim", v: e.v, to: subst(e.to, map), dir: e.dir, body: subst(e.body, without(map, e.v)) };
    case "diff":
      return { t: "diff", v: e.v, order: e.order, body: subst(e.body, without(map, e.v)) };
    case "def":
      return { t: "def", name: e.name, params: e.params, body: subst(e.body, without(map, e.params.join())) };
    default:
      return mapChildren(e, (c) => subst(c, map));
  }
}

/** Freie Symbole ohne Konstanten (π, e, …) und ohne gebundene Variablen. */
export function freeSymbols(e: Expr, bound: ReadonlySet<string> = new Set()): Set<string> {
  const out = new Set<string>();
  const walk = (x: Expr, b: ReadonlySet<string>): void => {
    switch (x.t) {
      case "sym": {
        if (!b.has(x.name) && !CONSTANTS.has(x.name)) out.add(x.name);
        return;
      }
      case "sum":
      case "prod": {
        walk(x.from, b);
        walk(x.to, b);
        walk(x.body, new Set([...b, x.v]));
        return;
      }
      case "int": {
        if (x.from) walk(x.from, b);
        if (x.to) walk(x.to, b);
        walk(x.body, new Set([...b, x.v]));
        return;
      }
      case "lim": {
        walk(x.to, b);
        walk(x.body, new Set([...b, x.v]));
        return;
      }
      case "diff": {
        // d/dv: v selbst bleibt frei, da das Ergebnis von v abhängt
        walk(x.body, b);
        return;
      }
      case "def": {
        walk(x.body, new Set([...b, ...x.params]));
        return;
      }
      default:
        mapChildren(x, (c) => (walk(c, b), c));
    }
  };
  walk(e, bound);
  return out;
}

export interface DefInfo {
  params: string[];
  body: Expr;
}

/** Ersetzt Aufrufe benutzerdefinierter Funktionen durch ihren Rumpf. */
export function inlineDefs(e: Expr, defs: Record<string, DefInfo>, depth = 0): Expr {
  if (depth > 40) throw new EngineError("Rekursive Funktionsdefinition", "recursion");
  if (e.t === "fn" && Object.prototype.hasOwnProperty.call(defs, e.name)) {
    const d = defs[e.name];
    if (d.params.length !== e.args.length) {
      throw new EngineError(`Funktion ${e.name} erwartet ${d.params.length} Argument(e)`, "arity");
    }
    const args = e.args.map((a) => inlineDefs(a, defs, depth + 1));
    const map: Record<string, Expr> = {};
    d.params.forEach((p, i) => (map[p] = args[i]));
    return inlineDefs(subst(d.body, map), defs, depth + 1);
  }
  return mapChildren(e, (c) => inlineDefs(c, defs, depth));
}
