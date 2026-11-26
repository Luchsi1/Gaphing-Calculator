import { useEffect, useMemo, useState } from "react";
import Tex from "./Tex.tsx";
import GraphWorkspace from "./GraphWorkspace.tsx";
import CalcView from "./CalcView.tsx";
import GeometryView from "./GeometryView.tsx";
import SliderRow from "./SliderRow.tsx";
import { buildModel } from "./graph/model.ts";
import { type Slider, createSlider, stepSlider, sliderParams } from "./graph/sliders.ts";
import { type History, initHistory } from "./geometry/history.ts";

const START = [
  String.raw`f(x)=x^3-3x`,
  String.raw`g(x)=x`,
  String.raw`\frac{1}{x^2-1}`,
  String.raw`x^2+y^2=4`,
  String.raw`r=1+\cos(\theta)\left\{0\le\theta\le2\pi\right\}`,
  String.raw`y<\frac{x}{2}-3`,
].join("\n");

export default function App() {
  const [src, setSrc] = useState<string>(START);
  const [tab, setTab] = useState<"graph" | "calc" | "geo">("graph");
  // Geometrie-Konstruktion samt Verlauf liegt hier, damit sie beim Reiterwechsel erhalten bleibt
  const [geo, setGeo] = useState<History>(() => initHistory());
  const [sliders, setSliders] = useState<Slider[]>([]);
  const params = useMemo(() => sliderParams(sliders), [sliders]);
  const model = useMemo(() => buildModel(src, params), [src, params]);

  /** Ergebnis als neue, frei editierbare Zeile übernehmen */
  const addLine = (latex: string): void => setSrc((prev) => `${prev.replace(/\s+$/, "")}\n${latex}`);

  const addSliders = (names: string[]): void =>
    setSliders((prev) => [...prev, ...names.filter((n) => !prev.some((s) => s.name === n)).map(createSlider)]);

  // Animation: alle laufenden Slider gleichzeitig
  const anyPlaying = sliders.some((s) => s.playing);
  useEffect(() => {
    if (!anyPlaying) return;
    let id = 0;
    let last = performance.now();
    const tick = (now: number): void => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      setSliders((prev) => prev.map((s) => (s.playing ? stepSlider(s, dt) : s)));
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [anyPlaying]);

  const missingNew = model.missing.filter((n) => !sliders.some((s) => s.name === n));

  return (
    <div className="app">
      {tab !== "geo" && (
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
                  {l.kind === "pending" && l.missing && (
                    <button className="small-btn" onClick={() => addSliders(l.missing ?? [])}>
                      Slider anlegen
                    </button>
                  )}
                </div>
              </li>
            ))}
        </ul>
        <div className="sliders">
          {missingNew.length > 0 && (
            <button className="small-btn" onClick={() => addSliders(missingNew)}>
              Slider für {missingNew.join(", ")} anlegen
            </button>
          )}
          {sliders.map((s) => (
            <SliderRow
              key={s.name}
              slider={s}
              onChange={(n) => setSliders((prev) => prev.map((x) => (x.name === s.name ? n : x)))}
              onRemove={() => setSliders((prev) => prev.filter((x) => x.name !== s.name))}
            />
          ))}
        </div>
      </aside>
      )}
      <main className="main">
        <div className="tabs">
          <button className={tab === "graph" ? "on" : ""} onClick={() => setTab("graph")}>Graph</button>
          <button className={tab === "calc" ? "on" : ""} onClick={() => setTab("calc")}>Rechner</button>
          <button className={tab === "geo" ? "on" : ""} onClick={() => setTab("geo")}>Geometrie</button>
        </div>
        {tab === "graph" ? (
          <GraphWorkspace items={model.items} lines={model.lines} onAddLine={addLine} />
        ) : tab === "calc" ? (
          <CalcView src={src} />
        ) : (
          <GeometryView history={geo} setHistory={setGeo} />
        )}
      </main>
    </div>
  );
}
