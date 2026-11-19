import { useMemo, useState } from "react";
import katex from "katex";

// Pipeline-Skelett: LaTeX-Eingabe -> KaTeX-Rendering, komplett offline.
// Parser, AST und Rechenengine folgen als eigene Module (src/engine).

const START = String.raw`\int_0^1 x^2\,dx = \frac{1}{3}`;

export default function App() {
  const [latex, setLatex] = useState(START);

  const result = useMemo(() => {
    try {
      return {
        html: katex.renderToString(latex, {
          displayMode: true,
          throwOnError: true,
        }),
        error: null as string | null,
      };
    } catch (e) {
      return { html: "", error: e instanceof Error ? e.message : String(e) };
    }
  }, [latex]);

  return (
    <div className="app">
      <aside className="panel">
        <h1>Ausdruck (LaTeX)</h1>
        <textarea
          value={latex}
          onChange={(e) => setLatex(e.target.value)}
          spellCheck={false}
        />
        {result.error && <p className="error">{result.error}</p>}
      </aside>
      <main className="canvas">
        {result.html && (
          <div dangerouslySetInnerHTML={{ __html: result.html }} />
        )}
      </main>
    </div>
  );
}
