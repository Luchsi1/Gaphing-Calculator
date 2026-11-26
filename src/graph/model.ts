// Zerlegt den Eingabetext (eine Zeile = ein Ausdruck) in darstellbare Objekte, Definitionen und Parameter.
import {
  parse, ParseError, EngineError, UndefinedSymbolError, CONSTANTS, freeSymbols, compile, compileRelation,
  evalNumber, toLatex, add, mul, NEG1, inlineDefs, subst, sym, derivative, mapChildren, simplify, type Expr, type DefInfo, type Context,
} from "../engine/index.ts";
import {
  type PlotItem, type ItemKind, explicitItem, parametricItem, polarItem, implicitItem, inequalityItem,
  inequalityExplicitItem, pointItem,
} from "./items.ts";

export const PALETTE = ["#c74440", "#2d70b3", "#388c46", "#6042a6", "#fa7e19", "#0e9aa7"];

export type LineKind = "empty" | "function" | "parameter" | "definition" | "pending" | "unsupported" | "error";

export interface LineInfo {
  index: number;
  src: string;
  kind: LineKind;
  color: string;
  latex?: string;
  message?: string;
  pos?: number;
  /** Darstellungsart, wenn die Zeile gezeichnet wird. */
  shape?: ItemKind;
  /** Noch undefinierte Parameter (dafür lassen sich Slider anlegen). */
  missing?: string[];
}

export interface PlotModel {
  lines: LineInfo[];
  items: PlotItem[];
  params: Record<string, number>;
  /** Vereinigung aller fehlenden Parameter. */
  missing: string[];
}

export const POLAR_DEFAULT: [number, number] = [0, 12 * Math.PI];
export const PARAMETRIC_DEFAULT: [number, number] = [-10, 10];

type Parsed = { expr: Expr } | { err: unknown } | null;
const IN_OPS = new Set(["<", ">", "<=", ">="]);
const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

function messageOf(e: unknown): string {
  if (e instanceof UndefinedSymbolError) return `Parameter „${e.symbol}“ ist nicht definiert`;
  return e instanceof Error ? e.message : String(e);
}

function safeLatex(e: Expr): string | undefined {
  try {
    return toLatex(e);
  } catch {
    return undefined;
  }
}

function paramDefinition(expr: Expr, params: Record<string, number>, defs: Record<string, DefInfo>): { name: string; value: number } | null {
  if (expr.t !== "rel" || expr.ops.length !== 1 || expr.ops[0] !== "=") return null;
  const [l, r] = expr.args;
  if (l.t !== "sym" || l.name === "x" || l.name === "y" || l.name === "r" || CONSTANTS.has(l.name)) return null;
  for (const s of freeSymbols(r)) if (!has(params, s)) return null;
  try {
    const value = evalNumber(r, params, defs);
    return Number.isFinite(value) ? { name: l.name, value } : null;
  } catch {
    return null;
  }
}

/**
 * Nullstellenmenge von F bei gerader Vielfachheit: u^(2k) hat dieselben Nullstellen wie u, aber keinen Vorzeichenwechsel.
 * Für implizite Kurven wie (x − y)² = 0 wird deshalb u gezeichnet.
 */
function reduceEven(e: Expr): Expr {
  let s: Expr;
  try {
    s = simplify(e);
  } catch {
    return e;
  }
  const un = (a: Expr): Expr => (a.t === "pow" && a.exp.t === "num" && a.exp.d === 1n && a.exp.n >= 2n && a.exp.n % 2n === 0n ? un(a.base) : a);
  return s.t === "mul" ? mul(...s.args.map(un)) : un(s);
}

/** Grenzen einer Variablen aus einer Bedingung wie 0 ≤ t ≤ 2π (nur konstante Grenzen). */
export function extractRange(cond: Expr, v: string, ctx: Context): { lo: number | null; hi: number | null } {
  let lo: number | null = null;
  let hi: number | null = null;
  const items = cond.t === "tuple" ? cond.items : [cond];
  const constant = (e: Expr): number | null => {
    for (const s of freeSymbols(e)) if (!ctx.params || !has(ctx.params, s)) return null;
    try {
      const x = evalNumber(e, ctx.params ?? {}, ctx.defs);
      return Number.isFinite(x) ? x : null;
    } catch {
      return null;
    }
  };
  for (const it of items) {
    if (it.t !== "rel") continue;
    for (let i = 0; i < it.ops.length; i++) {
      const op = it.ops[i];
      const a = it.args[i];
      const b = it.args[i + 1];
      const aIsV = a.t === "sym" && a.name === v;
      const bIsV = b.t === "sym" && b.name === v;
      if (!(aIsV || bIsV) || !IN_OPS.has(op)) continue;
      const val = constant(aIsV ? b : a);
      if (val === null) continue;
      const upper = aIsV ? op === "<" || op === "<=" : op === ">" || op === ">=";
      if (upper) hi = hi === null ? val : Math.min(hi, val);
      else lo = lo === null ? val : Math.max(lo, val);
    }
  }
  return { lo, hi };
}

export function buildModel(src: string, extraParams: Record<string, number> = {}): PlotModel {
  const raw = src.split("\n");
  const blank = raw.map((s) => s.trim() === "");

  // 1. Durchlauf: Namen der Funktionsdefinitionen f(x)=… einsammeln
  const nameSet = new Set<string>();
  raw.forEach((s, i) => {
    if (blank[i]) return;
    try {
      const e = parse(s);
      if (e.t === "def") nameSet.add(e.name);
    } catch {
      /* Fehler werden im 2. Durchlauf gemeldet */
    }
  });
  const names = [...nameSet];

  // 2. Durchlauf: mit bekannten Funktionsnamen parsen (so werden Aufrufe wie g(x)=f(x)+1 richtig gelesen)
  const parsed: Parsed[] = raw.map((s, i) => {
    if (blank[i]) return null;
    try {
      return { expr: parse(s, { functions: names }) };
    } catch (err) {
      return { err };
    }
  });
  const defs: Record<string, DefInfo> = {};
  for (const p of parsed) {
    if (p && "expr" in p && p.expr.t === "def") defs[p.expr.name] = { params: p.expr.params, body: p.expr.body };
  }

  // Ableitungen f'(x), f''(x) benutzerdefinierter Funktionen: als zusätzliche Definitionen bereitstellen
  for (let round = 0, changed = true; changed && round < 10; round++) {
    changed = false;
    const used = new Set<string>();
    const walk = (x: Expr): void => {
      if (x.t === "fn" && x.name.endsWith("'")) used.add(x.name);
      mapChildren(x, (c) => (walk(c), c));
    };
    for (const p of parsed) if (p && "expr" in p) walk(p.expr);
    for (const d of Object.values(defs)) walk(d.body);
    for (const nm of used) {
      if (has(defs, nm)) continue;
      const base = nm.replace(/'+$/, "");
      const bd = has(defs, base) ? defs[base] : undefined;
      if (!bd || bd.params.length !== 1) continue;
      try {
        defs[nm] = { params: bd.params, body: derivative(inlineDefs(bd.body, defs), bd.params[0], nm.length - base.length) };
        changed = true;
      } catch {
        /* keine Ableitungsregel: die Zeile meldet „Unbekannte Funktion“ */
      }
    }
  }

  // Parameter: Slider-Werte, dann Zeilen wie a=2 in Textreihenfolge (Zeilen gewinnen)
  const params: Record<string, number> = { ...extraParams };
  for (const p of parsed) {
    if (p && "expr" in p) {
      const pd = paramDefinition(p.expr, params, defs);
      if (pd) params[pd.name] = pd.value;
    }
  }
  const ctx: Context = { params, defs };

  const items: PlotItem[] = [];
  const allMissing = new Set<string>();

  const lines: LineInfo[] = parsed.map((p, i) => {
    const color = PALETTE[i % PALETTE.length];
    const base = { index: i, src: raw[i], color };
    const itemBase = { id: `line-${i}`, line: i, color };
    if (!p) return { ...base, kind: "empty" as const };
    if ("err" in p) {
      return { ...base, kind: "error" as const, message: messageOf(p.err), pos: p.err instanceof ParseError ? p.err.pos : undefined };
    }
    const full = p.expr;
    const latex = safeLatex(full);
    const unsupported = (message: string): LineInfo => ({ ...base, kind: "unsupported", latex, message });
    const plotted = (shape: ItemKind): LineInfo => ({ ...base, kind: "function", latex, shape });

    // Definitionsbereich abtrennen
    const cond: Expr | null = full.t === "restrict" ? full.cond : null;
    const expr: Expr = full.t === "restrict" ? full.body : full;
    const withCond = (body: Expr): Expr => (cond ? { t: "restrict", body, cond } : body);

    // Freie Symbole außerhalb der erlaubten Variablen und Parameter
    const missingOf = (parts: Expr[], allowed: string[]): string[] => {
      const free = new Set<string>();
      parts.forEach((q) => freeSymbols(q).forEach((s) => free.add(s)));
      if (cond) freeSymbols(cond).forEach((s) => free.add(s));
      return [...free].filter((s) => !allowed.includes(s) && !has(params, s)).sort();
    };
    const pending = (missing: string[]): LineInfo => {
      missing.forEach((m) => allMissing.add(m));
      return { ...base, kind: "pending", latex, missing, message: `Parameter fehlen: ${missing.join(", ")}` };
    };

    try {
      // ---- Funktion einer Variablen (explizit) ----
      const explicit = (body: Expr, v: string): LineInfo => {
        const m = missingOf([body], [v]);
        if (m.length) return pending(m);
        const f1 = compile(withCond(body), [v], ctx);
        const it = explicitItem(itemBase, (x) => f1(x), { expr: inlineDefs(withCond(body), defs), v, params });
        it.curve = { F: add(sym("y"), mul(NEG1, subst(inlineDefs(body, defs), { [v]: sym("x") }))), params };
        items.push(it);
        return plotted("explicit");
      };

      if (expr.t === "def") {
        if (expr.params.length !== 1) return { ...base, kind: "definition", latex, message: "Mehrstellige Funktion gespeichert (nicht im Graphen darstellbar)" };
        const m = missingOf([expr.body], [expr.params[0]]);
        if (m.length) return pending(m);
        const f1 = compile(expr.body, [expr.params[0]], ctx);
        const it = explicitItem(itemBase, (x) => f1(x), { expr: inlineDefs(expr.body, defs), v: expr.params[0], params });
        const inner = expr.body.t === "restrict" ? expr.body.body : expr.body;
        it.curve = { F: add(sym("y"), mul(NEG1, subst(inlineDefs(inner, defs), { [expr.params[0]]: sym("x") }))), params };
        items.push(it);
        return plotted("explicit");
      }

      if (expr.t === "rel") {
        const pd = paramDefinition(expr, params, defs);
        if (pd && !cond && expr.args[0].t === "sym" && params[pd.name] === pd.value) {
          return { ...base, kind: "parameter", latex, message: `${pd.name} = ${pd.value}` };
        }
        const [L, R] = expr.args;
        const free = (e: Expr): Set<string> => freeSymbols(e);

        if (expr.ops.length === 1 && expr.ops[0] === "=") {
          // Polarkurve r = f(θ)
          const rSide = L.t === "sym" && L.name === "r" ? R : R.t === "sym" && R.name === "r" ? L : null;
          if (rSide) {
            const fs = [...free(rSide)].filter((s) => !has(params, s));
            if (fs.every((s) => s === "theta")) {
              const rf = compile(rSide, ["theta"], ctx);
              const rng = cond ? extractRange(cond, "theta", ctx) : { lo: null, hi: null };
              const t0 = rng.lo ?? POLAR_DEFAULT[0];
              const t1 = rng.hi ?? POLAR_DEFAULT[1];
              if (!(t1 > t0)) return unsupported("Ungültiger Bereich für θ");
              const mask = cond ? compileRelation(cond, ["theta"], ctx) : null;
              items.push(polarItem(itemBase, (th) => (mask && !mask(th) ? NaN : rf(th)), t0, t1));
              return plotted("polar");
            }
          }
          // y = f(x)
          if (L.t === "sym" && L.name === "y" && !free(R).has("y")) return explicit(R, "x");
          if (R.t === "sym" && R.name === "y" && !free(L).has("y")) return explicit(L, "x");
          // implizite Kurve
          const m = missingOf([L, R], ["x", "y"]);
          if (m.length) return pending(m);
          const h = compile(reduceEven(add(L, mul(NEG1, R))), ["x", "y"], ctx);
          const mask = cond ? compileRelation(cond, ["x", "y"], ctx) : undefined;
          const imp = implicitItem(itemBase, (x, y) => h(x, y), mask && ((x, y) => mask(x, y)));
          imp.curve = { F: inlineDefs(add(L, mul(NEG1, R)), defs), params };
          items.push(imp);
          return plotted("implicit");
        }

        if (expr.ops.every((o) => IN_OPS.has(o))) {
          const m = missingOf(expr.args, ["x", "y"]);
          if (m.length) return pending(m);
          const mask = cond ? compileRelation(cond, ["x", "y"], ctx) : undefined;
          const m2 = mask && ((x: number, y: number) => mask(x, y));
          // Spezialfall y < g(x): exakte Füllung
          if (expr.ops.length === 1 && !cond) {
            const op = expr.ops[0];
            const yLeft = L.t === "sym" && L.name === "y" && !free(R).has("y");
            const yRight = R.t === "sym" && R.name === "y" && !free(L).has("y");
            if (yLeft || yRight) {
              const g = compile(yLeft ? R : L, ["x"], ctx);
              const below = yLeft ? op === "<" || op === "<=" : op === ">" || op === ">=";
              items.push(inequalityExplicitItem(itemBase, (x) => g(x), below, op === "<" || op === ">"));
              return plotted("inequality");
            }
          }
          const cons = expr.ops.map((op, k) => {
            const h = compile(add(expr.args[k], mul(NEG1, expr.args[k + 1])), ["x", "y"], ctx);
            return { op, h: (x: number, y: number) => h(x, y) };
          });
          items.push(inequalityItem(itemBase, cons, m2));
          return plotted("inequality");
        }
        return unsupported("Diese Relation wird im Graphen nicht dargestellt");
      }

      if (expr.t === "tuple") {
        if (expr.items.length !== 2) return unsupported("Nur 2D-Punkte (x, y) und Kurven (x(t), y(t)) werden dargestellt");
        const [X, Y] = expr.items;
        const free = new Set<string>();
        [X, Y].forEach((q) => freeSymbols(q).forEach((s) => free.add(s)));
        const varying = [...free].filter((s) => !has(params, s));
        if (varying.length === 0 || (varying.length === 1 && varying[0] === "t")) {
          const m = missingOf([X, Y], varying.length ? ["t"] : []);
          if (m.length) return pending(m);
          if (varying.length === 0) {
            const x = evalNumber(X, params, defs);
            const y = evalNumber(Y, params, defs);
            items.push(pointItem(itemBase, x, y));
            return plotted("point");
          }
          const xf = compile(X, ["t"], ctx);
          const yf = compile(Y, ["t"], ctx);
          const rng = cond ? extractRange(cond, "t", ctx) : { lo: null, hi: null };
          const t0 = rng.lo ?? PARAMETRIC_DEFAULT[0];
          const t1 = rng.hi ?? PARAMETRIC_DEFAULT[1];
          if (!(t1 > t0)) return unsupported("Ungültiger Bereich für t");
          const mask = cond ? compileRelation(cond, ["t"], ctx) : null;
          items.push(parametricItem(itemBase, (t) => (mask && !mask(t) ? [NaN, NaN] : [xf(t), yf(t)]), t0, t1));
          return plotted("parametric");
        }
        return pending(missingOf([X, Y], ["t"]));
      }

      if (expr.t === "matrix") return unsupported("Matrizen werden im Graphen nicht dargestellt");

      // Ausdruck in x (auch stückweise): y = f(x)
      if (freeSymbols(expr).has("y") && !has(params, "y")) return unsupported("Enthält y – als Gleichung schreiben, z. B. y=…");
      return explicit(expr, "x");
    } catch (err) {
      if (err instanceof UndefinedSymbolError) {
        allMissing.add(err.symbol);
        return { ...base, kind: "pending" as const, latex, missing: [err.symbol], message: `Parameter fehlen: ${err.symbol}` };
      }
      if (!(err instanceof EngineError)) throw err;
      return { ...base, kind: "error" as const, latex, message: messageOf(err) };
    }
  });

  return { lines, items, params, missing: [...allMissing].sort() };
}
