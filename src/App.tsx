import { useMemo, useState } from "react";
import Tex from "./Tex.tsx";
import GraphView from "./GraphView.tsx";
import CalcView from "./CalcView.tsx";
import { buildModel } from "./graph/model.ts";

const START = [
  String.raw`f(x)=\sin(x)`,
  String.raw`\frac{1}{x}`,
  String.raw`\tan(x)`,
  String.raw`\lfloor x \rfloor`,
  String.raw`a=2`,
  String.raw`\frac{x^2}{a}-3`,
].join("\n");

export default function App() {
  const [src, setSrc] = useState<string>(START);
  const [tab, setTab] = useState<"graph" | "calc">("graph");
  const model = useMemo(() => buildModel(src), [src]);

  return (
    <div className="app">
      <aside className="panel">
        <h1>Ausdrücke (LaTeX, eine pro Zeile)</h1>
        <textarea value={src} onChange={(e: { target: { value: string } }) => setSrc(e.target.value)} spellCheck={false} />
        <ul className="lines">
          {model.lines
            .filter((l) => l.kind !== "empty")
            .map((l) => (
              <li key={l.index} className={l.kind}>
                <span className="swatch" style={{ background: l.kind === "function" ? l.color : "transparent" }} />
                <div className="body">
                  {l.latex ? <Tex latex={l.latex} inline /> : <code>{l.src}</code>}
                  {l.message && (
                    <div className={l.kind === "error" ? "error" : "note"}>
                      {l.message}
                      {l.kind === "error" && l.pos !== undefined ? ` (Position ${l.pos + 1})` : ""}
                    </div>
                  )}
                </div>
              </li>
            ))}
        </ul>
      </aside>
      <main className="main">
        <div className="tabs">
          <button className={tab === "graph" ? "on" : ""} onClick={() => setTab("graph")}>Graph</button>
          <button className={tab === "calc" ? "on" : ""} onClick={() => setTab("calc")}>Rechner</button>
        </div>
        {tab === "graph" ? <GraphView fns={model.fns} /> : <CalcView src={src} />}
      </main>
    </div>
  );
}
