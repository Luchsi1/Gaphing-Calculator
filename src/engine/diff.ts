// Symbolische Differentiation (Ketten-, Produkt-, Potenzregel, Hauptsatz der Analysis).
import {
  type Expr, ZERO, ONE, NEG1, num, sym, add, mul, pow, fn, subst, freeSymbols, EngineError,
} from "./ast.ts";
import { simplify } from "./simplify.ts";

const dep = (e: Expr, v: string): boolean => freeSymbols(e).has(v);

/** n-te Ableitung nach v, vereinfacht. */
export function derivative(e: Expr, v: string, order = 1): Expr {
  let r = simplify(e);
  for (let i = 0; i < order; i++) r = simplify(d(r, v));
  return r;
}

function d(e: Expr, v: string): Expr {
  if (!dep(e, v)) return ZERO;
  switch (e.t) {
    case "num":
      return ZERO;
    case "sym":
      return ONE;
    case "add":
      return add(...e.args.map((a) => d(a, v)));
    case "mul":
      return add(...e.args.map((_, i) => mul(...e.args.map((a, j) => (i === j ? d(a, v) : a)))));
    case "pow": {
      const bd = dep(e.base, v);
      const ed = dep(e.exp, v);
      if (!ed) return mul(e.exp, pow(e.base, add(e.exp, NEG1)), d(e.base, v));
      if (!bd) return mul(e, fn("ln", e.base), d(e.exp, v));
      return mul(e, add(mul(d(e.exp, v), fn("ln", e.base)), mul(e.exp, d(e.base, v), pow(e.base, NEG1))));
    }
    case "fn": {
      const u = e.args[0];
      const du = (): Expr => d(u, v);
      const sq = (x: Expr): Expr => pow(x, num(2));
      switch (e.name) {
        case "sin": return mul(fn("cos", u), du());
        case "cos": return mul(NEG1, fn("sin", u), du());
        case "tan": return mul(pow(fn("cos", u), num(-2)), du());
        case "cot": return mul(NEG1, pow(fn("sin", u), num(-2)), du());
        case "arcsin": return mul(pow(add(ONE, mul(NEG1, sq(u))), num(-1, 2)), du());
        case "arccos": return mul(NEG1, pow(add(ONE, mul(NEG1, sq(u))), num(-1, 2)), du());
        case "arctan": return mul(pow(add(ONE, sq(u)), NEG1), du());
        case "sinh": return mul(fn("cosh", u), du());
        case "cosh": return mul(fn("sinh", u), du());
        case "tanh": return mul(pow(fn("cosh", u), num(-2)), du());
        case "ln": return mul(pow(u, NEG1), du());
        case "abs": return mul(fn("sign", u), du());
        case "floor": case "ceil": case "round": case "sign": return ZERO;
        default:
          throw new EngineError(`Keine Ableitungsregel für „${e.name}“`, "no-derivative");
      }
    }
    case "sum": {
      if (dep(e.from, v) || dep(e.to, v)) throw new EngineError("Ableitung einer Summe mit variablen Grenzen wird nicht unterstützt");
      return { t: "sum", v: e.v, from: e.from, to: e.to, body: d(e.body, v) };
    }
    case "prod":
      throw new EngineError("Ableitung eines Produkts ∏ wird nicht unterstützt");
    case "int": {
      const free = freeSymbols(e.body, new Set([e.v]));
      if (free.has(v)) throw new EngineError("Ableitung eines Integrals mit parameterabhängigem Integranden wird nicht unterstützt");
      const at = (x: Expr): Expr => subst(e.body, { [e.v]: x });
      if (!e.from && !e.to) return at(sym(v));
      const hi = e.to ? mul(at(e.to), d(e.to, v)) : ZERO;
      const lo = e.from ? mul(NEG1, at(e.from), d(e.from, v)) : ZERO;
      return add(hi, lo);
    }
    case "diff":
      return d(simplify(e), v);
    case "cases":
      return { t: "cases", rows: e.rows.map((r) => ({ value: d(r.value, v), cond: r.cond })) };
    case "tuple":
      return { t: "tuple", items: e.items.map((x) => d(x, v)) };
    default:
      throw new EngineError(`Ableitung für „${e.t}“ nicht unterstützt`);
  }
}
