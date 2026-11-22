import { useMemo } from "react";
import Tex from "./Tex.tsx";
import SolveSections from "./SolveSections.tsx";
import {
  parse, ParseError, simplify, derivative, toLatex, freeSymbols, evalNumber, numberToLatex, type Expr,
} from "./engine/index.ts";

interface Analysis {
  input?: string;
  simplified?: string;
  derivative?: string;
  numeric?: string;
  notes: string[];
  error?: { message: string; pos?: number };
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function analyze(src: string): Analysis {
  const out: Analysis = { notes: [] };
  let expr: Expr;
  try {
    expr = parse(src);
  } catch (e) {
    out.error = { message: messageOf(e), pos: e instanceof ParseError ? e.pos : undefined };
    return out;
  }
  out.input = toLatex(expr);
  if (expr.t === "rel" || expr.t === "def" || expr.t === "matrix" || expr.t === "tuple") return out;
  try {
    out.simplified = toLatex(simplify(expr));
  } catch (e) {
    out.notes.push(messageOf(e));
  }
  const free = freeSymbols(expr);
  if (free.size === 0) {
    try {
      out.numeric = numberToLatex(evalNumber(expr));
    } catch (e) {
      out.notes.push(messageOf(e));
    }
  } else if (free.size === 1 && free.has("x")) {
    try {
      out.derivative = toLatex(derivative(expr, "x"));
    } catch (e) {
      out.notes.push(messageOf(e));
    }
  } else {
    out.notes.push(`Freie Variablen: ${[...free].join(", ")}`);
  }
  return out;
}

/** Rechner: Gleichungen und Systeme lösen, Stammfunktion, exakte Vereinfachung, Näherungswert, Ableitung. */
export default function CalcView({ src }: { src: string }) {
  const line = useMemo(() => src.split("\n").find((l) => l.trim() !== "") ?? "", [src]);
  const a = useMemo(() => (line ? analyze(line) : null), [line]);
  if (!a) return <div className="calc"><p className="note">Gib links einen Ausdruck ein.</p></div>;
  return (
    <div className="calc">
      <SolveSections src={src} />
      <p className="note">Rechner für die erste Zeile: <code>{line}</code></p>
      {a.error && (
        <p className="error">
          {a.error.message}
          {a.error.pos !== undefined ? ` (Position ${a.error.pos + 1})` : ""}
        </p>
      )}
      {a.notes.map((n, i) => (
        <p className="note" key={i}>{n}</p>
      ))}
      {a.input && <section><h2>Eingabe</h2><Tex latex={a.input} /></section>}
      {a.simplified && <section><h2>Exakt vereinfacht</h2><Tex latex={a.simplified} /></section>}
      {a.numeric && <section><h2>Näherungswert (numerisch)</h2><Tex latex={`\\approx ${a.numeric}`} /></section>}
      {a.derivative && (
        <section>
          <h2>Ableitung nach x (exakt)</h2>
          <Tex latex={`\\frac{d}{dx}\\left(${a.input ?? ""}\\right) = ${a.derivative}`} />
        </section>
      )}
    </div>
  );
}
