// Zerlegt den Eingabetext (eine Zeile = ein Ausdruck) in darstellbare Funktionen, Definitionen und Parameter.
import {
  parse, ParseError, EngineError, UndefinedSymbolError, CONSTANTS, freeSymbols, compile, evalNumber, toLatex,
  type Expr, type DefInfo,
} from "../engine/index.ts";

export const PALETTE = ["#c74440", "#2d70b3", "#388c46", "#6042a6", "#fa7e19", "#0e9aa7"];

export type LineKind = "empty" | "function" | "parameter" | "definition" | "unsupported" | "error";

export interface LineInfo {
  index: number;
  src: string;
  kind: LineKind;
  color: string;
  latex?: string;
  message?: string;
  pos?: number;
}

export interface PlotFn {
  id: string;
  line: number;
  f: (x: number) => number;
  color: string;
}

export interface PlotModel {
  lines: LineInfo[];
  fns: PlotFn[];
  params: Record<string, number>;
}

type Parsed = { expr: Expr } | { err: unknown } | null;

function messageOf(e: unknown): string {
  if (e instanceof UndefinedSymbolError) {
    return `Variable „${e.symbol}“ ist nicht definiert – z. B. mit ${e.symbol}=1 in einer eigenen Zeile festlegen`;
  }
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
  if (l.t !== "sym" || l.name === "x" || l.name === "y" || CONSTANTS.has(l.name)) return null;
  for (const s of freeSymbols(r)) if (!Object.prototype.hasOwnProperty.call(params, s)) return null;
  try {
    const value = evalNumber(r, params, defs);
    return Number.isFinite(value) ? { name: l.name, value } : null;
  } catch {
    return null;
  }
}

export function buildModel(src: string): PlotModel {
  const raw = src.split("\n");
  const blank = raw.map((s) => s.trim() === "");

  // 1. Durchlauf: Funktionsdefinitionen f(x)=… einsammeln
  const defs: Record<string, DefInfo> = {};
  raw.forEach((s, i) => {
    if (blank[i]) return;
    try {
      const e = parse(s);
      if (e.t === "def") defs[e.name] = { params: e.params, body: e.body };
    } catch {
      /* Fehler werden im 2. Durchlauf gemeldet */
    }
  });
  const names = Object.keys(defs);

  // 2. Durchlauf: mit bekannten Funktionsnamen parsen
  const parsed: Parsed[] = raw.map((s, i) => {
    if (blank[i]) return null;
    try {
      return { expr: parse(s, { functions: names }) };
    } catch (err) {
      return { err };
    }
  });

  // Parameter (a=2) in Textreihenfolge auswerten
  const params: Record<string, number> = {};
  for (const p of parsed) {
    if (p && "expr" in p) {
      const pd = paramDefinition(p.expr, params, defs);
      if (pd) params[pd.name] = pd.value;
    }
  }

  const fns: PlotFn[] = [];
  const lines: LineInfo[] = parsed.map((p, i) => {
    const color = PALETTE[i % PALETTE.length];
    const base = { index: i, src: raw[i], color };
    if (!p) return { ...base, kind: "empty" as const };
    if ("err" in p) {
      return { ...base, kind: "error" as const, message: messageOf(p.err), pos: p.err instanceof ParseError ? p.err.pos : undefined };
    }
    const expr = p.expr;
    const latex = safeLatex(expr);
    const ctx = { params, defs };

    let body: Expr | null = null;
    let v = "x";
    if (expr.t === "def") {
      if (expr.params.length !== 1) {
        return { ...base, kind: "definition" as const, latex, message: "Mehrstellige Funktion gespeichert (nicht im Graphen darstellbar)" };
      }
      body = expr.body;
      v = expr.params[0];
    } else if (expr.t === "rel") {
      const pd = paramDefinition(expr, params, defs);
      if (pd && expr.args[0].t === "sym" && params[pd.name] === pd.value) {
        return { ...base, kind: "parameter" as const, latex, message: `${pd.name} = ${pd.value}` };
      }
      if (expr.ops.length === 1 && expr.ops[0] === "=" && expr.args[0].t === "sym" && expr.args[0].name === "y") body = expr.args[1];
      else if (expr.ops.length === 1 && expr.ops[0] === "=" && expr.args[1].t === "sym" && expr.args[1].name === "y") body = expr.args[0];
      else {
        return { ...base, kind: "unsupported" as const, latex, message: "Gleichungen, Ungleichungen und implizite Kurven folgen im nächsten Schritt" };
      }
    } else if (expr.t === "tuple" || expr.t === "matrix") {
      return { ...base, kind: "unsupported" as const, latex, message: "Punkte, Vektoren und Matrizen werden hier noch nicht dargestellt" };
    } else {
      body = expr;
    }

    try {
      const f1 = compile(body, [v], ctx);
      fns.push({ id: `line-${i}`, line: i, f: (x: number) => f1(x), color });
      return { ...base, kind: "function" as const, latex };
    } catch (err) {
      if (!(err instanceof EngineError)) throw err;
      return { ...base, kind: "error" as const, latex, message: messageOf(err) };
    }
  });

  return { lines, fns, params };
}
