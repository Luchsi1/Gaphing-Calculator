import { useMemo, useState } from "react";
import katex from "katex";
import {
  parse, ParseError, simplify, derivative, toLatex, freeSymbols, evalNumber, numberToLatex,
  type Expr,
} from "./engine/index.ts";

const START = String.raw`\int_0^1 x^2\,dx`;

interface Analysis {
  input?: string;
  simplified?: string;
  derivative?: string;
  numeric?: string;
  notes: string[];
  error?: { message: string; pos?: number };
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

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

function Tex({ latex }: { latex: string }) {
  const html = useMemo(
    () => katex.renderToString(latex, { displayMode: true, throwOnError: false }),
    [latex]
  );
  return <div className="tex" dangerouslySetInnerHTML={{ __html: html }} />;
}

export default function App() {
  const [latex, setLatex] = useState(START);
  const a = useMemo(() => analyze(latex), [latex]);

  return (
    <div className="app">
      <aside className="panel">
        <h1>Ausdruck (LaTeX)</h1>
        <textarea value={latex} onChange={(e) => setLatex(e.target.value)} spellCheck={false} />
        {a.error && (
          <p className="error">
            {a.error.message}
            {a.error.pos !== undefined ? ` (Position ${a.error.pos + 1})` : ""}
          </p>
        )}
        {a.notes.map((n, i) => (
          <p className="note" key={i}>{n}</p>
        ))}
      </aside>
      <main className="canvas">
        {a.input && (
          <section>
            <h2>Eingabe</h2>
            <Tex latex={a.input} />
          </section>
        )}
        {a.simplified && (
          <section>
            <h2>Exakt vereinfacht</h2>
            <Tex latex={a.simplified} />
          </section>
        )}
        {a.numeric && (
          <section>
            <h2>Näherungswert (numerisch)</h2>
            <Tex latex={`\\approx ${a.numeric}`} />
          </section>
        )}
        {a.derivative && (
          <section>
            <h2>Ableitung nach x (exakt)</h2>
            <Tex latex={`\\frac{d}{dx}\\left(${a.input ?? ""}\\right) = ${a.derivative}`} />
          </section>
        )}
      </main>
    </div>
  );
}
