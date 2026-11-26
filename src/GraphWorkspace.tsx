import { useMemo, useState } from "react";
import GraphView, { type HoverMarker } from "./GraphView.tsx";
import Tex from "./Tex.tsx";
import type { PlotItem } from "./graph/items.ts";
import type { LineInfo } from "./graph/model.ts";
import type { Ranges } from "./graph/viewport.ts";
import { markersItem, guidesItem, areaItem, lineItem, relationItem } from "./graph/overlay.ts";
import { analyzeFunction, intersections, intersectCurves, tangentNormal, areaBetween, integralOf } from "./analysis/function.ts";
import { entriesOf, pointLatex, pointLine, plainPoint, approx, type Entry } from "./analysis/format.ts";
import { parse, simplify, derivative, compile, toLatex, numberToLatex, subst, sym, type Expr } from "./engine/index.ts";

type Attempt<T> = { ok: true; v: T } | { ok: false; msg: string };
function attempt<T>(f: () => T): Attempt<T> {
  try {
    return { ok: true, v: f() };
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : String(e) };
  }
}

const C = {
  root: "#c2410c", max: "#15803d", min: "#1d4ed8", infl: "#7e22ce", hole: "#6b7280", icpt: "#0f766e",
  asym: "#6b7280", inter: "#be123c", tan: "#0891b2", nor: "#a21caf",
};

const KIND_COLOR: Record<Entry["kind"], string> = {
  root: C.root, max: C.max, min: C.min, inflection: C.infl, intercept: C.icpt, hole: C.hole,
  vertical: C.asym, horizontal: C.asym, slant: C.asym,
};

interface Props {
  items: PlotItem[];
  lines: LineInfo[];
  onAddLine: (latex: string) => void;
}

function AddBtn({ onClick }: { onClick: () => void }) {
  return (
    <button className="small-btn" title="Als neue Zeile übernehmen (danach frei editierbar)" onClick={onClick}>
      → Zeile
    </button>
  );
}

const Badge = ({ exact }: { exact: boolean }) => (
  <span className={exact ? "badge exact" : "badge approx"}>{exact ? "exakt" : "Näherung"}</span>
);

export default function GraphWorkspace({ items, lines, onAddLine }: Props) {
  const curves = useMemo(() => items.filter((i) => i.curve), [items]);
  const [sel, setSel] = useState<number | null>(null);
  const [sel2, setSel2] = useState<number | null>(null);
  const [vis, setVis] = useState<Ranges>({ xMin: -10, xMax: 10, yMin: -7, yMax: 7 });
  const range = useMemo<[number, number]>(() => [vis.xMin, vis.xMax], [vis.xMin, vis.xMax]);
  const [show, setShow] = useState({ roots: true, extrema: true, inflections: false, asymptotes: true, d1: false, d2: false });
  const [open, setOpen] = useState<boolean>(true);
  const [tOn, setTOn] = useState<boolean>(false);
  const [tx, setTx] = useState<string>("1");
  const [picking, setPicking] = useState<boolean>(false);
  const [intOn, setIntOn] = useState<boolean>(false);
  const [intMode, setIntMode] = useState<"integral" | "area">("area");
  const [intA, setIntA] = useState<string>("0");
  const [intB, setIntB] = useState<string>("1");
  const [interOn, setInterOn] = useState<boolean>(false);

  const item = curves.find((i) => i.line === sel) ?? curves[0] ?? null;
  const item2 = sel2 !== null ? curves.find((i) => i.line === sel2 && i !== item) ?? null : null;
  /** nur explizite Funktionen lassen sich analysieren, integrieren und als Fläche begrenzen */
  const item2e = item2 && item2.analysis ? item2 : null;
  const an = item ? item.analysis : undefined;

  /** Ausdruck des zweiten Objekts in der Variablen des ersten */
  const inV = (it: PlotItem, v: string): Expr => (it.analysis && it.analysis.v !== v ? subst(it.analysis.expr, { [it.analysis.v]: sym(v) }) : (it.analysis as { expr: Expr }).expr);

  const wantAnalysis = show.roots || show.extrema || show.inflections || show.asymptotes;
  const analysis = useMemo(
    () => (an && wantAnalysis ? attempt(() => analyzeFunction(an.expr, an.v, an.params, range)) : null),
    [an, range, wantAnalysis]
  );
  const entries = useMemo<Entry[]>(() => {
    if (!analysis || !analysis.ok) return [];
    return entriesOf(analysis.v).filter((e) => {
      if (e.kind === "root" || e.kind === "intercept") return show.roots;
      if (e.kind === "max" || e.kind === "min") return show.extrema;
      if (e.kind === "inflection") return show.inflections;
      return show.asymptotes;
    });
  }, [analysis, show]);

  const deriv = useMemo(
    () =>
      an && (show.d1 || show.d2)
        ? attempt(() => {
            const d1 = derivative(an.expr, an.v);
            const d2 = derivative(an.expr, an.v, 2);
            const f1 = compile(d1, [an.v], { params: an.params });
            const f2 = compile(d2, [an.v], { params: an.params });
            return { d1, d2, f1: (x: number) => f1(x), f2: (x: number) => f2(x) };
          })
        : null,
    [an, show.d1, show.d2]
  );

  const tangent = useMemo(
    () => (tOn && an ? attempt(() => tangentNormal(an.expr, an.v, an.params, parse(tx))) : null),
    [tOn, an, tx]
  );

  const inter = useMemo(
    () =>
      interOn && item && item2 && item.curve && item2.curve
        ? attempt(() =>
            an && item2.analysis
              ? intersections(an.expr, inV(item2, an.v), an.v, an.params, range)
              : intersectCurves(item.curve!.F, item2.curve!.F, item.curve!.params, [vis.xMin, vis.xMax], [vis.yMin, vis.yMax])
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [interOn, item, item2, vis]
  );

  const integral = useMemo(
    () =>
      intOn && an
        ? attempt(() => {
            const a = simplify(parse(intA));
            const b = simplify(parse(intB));
            return intMode === "integral"
              ? { mode: "integral" as const, r: integralOf(an.expr, an.v, an.params, a, b), a, b }
              : { mode: "area" as const, r: areaBetween(an.expr, item2e ? inV(item2e, an.v) : null, an.v, an.params, a, b), a, b };
          })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intOn, an, item2e, intA, intB, intMode]
  );

  // ---------- Zusatzobjekte im Graphen ----------
  const overlay = useMemo<PlotItem[]>(() => {
    const out: PlotItem[] = [];
    const b = (id: string, color: string) => ({ id, line: -1, color });
    if (analysis && analysis.ok) {
      const a = analysis.v;
      if (show.roots) {
        out.push(markersItem(b("ov-roots", C.root), a.roots, "circle"));
        if (a.yIntercept) out.push(markersItem(b("ov-icpt", C.icpt), [a.yIntercept], "square"));
      }
      if (show.extrema) {
        out.push(markersItem(b("ov-max", C.max), a.maxima, "up"));
        out.push(markersItem(b("ov-min", C.min), a.minima, "down"));
      }
      if (show.inflections) out.push(markersItem(b("ov-inf", C.infl), a.inflections, "diamond"));
      if (show.asymptotes) {
        out.push(guidesItem(b("ov-asym", C.asym), [
          ...a.vertical.map((v) => ({ kind: "v" as const, x: v.x })),
          ...a.horizontal.map((h) => ({ kind: "h" as const, y: h.y })),
          ...a.slant.map((s) => ({ kind: "line" as const, m: s.m, b: s.b })),
        ]));
        out.push(markersItem(b("ov-holes", C.hole), a.holes, "ring"));
      }
    }
    if (item && deriv && deriv.ok) {
      if (show.d1) out.push(lineItem(b("ov-d1", item.color), deriv.v.f1, true));
      if (show.d2) out.push(lineItem(b("ov-d2", item.color), deriv.v.f2, true));
    }
    if (tangent && tangent.ok && an) {
      const t = tangent.v;
      const ti = relationItem(b("ov-tan", C.tan), t.tangent, an.params);
      const ni = relationItem(b("ov-nor", C.nor), t.normal, an.params, true);
      if (ti) out.push(ti);
      if (ni) out.push(ni);
      out.push(markersItem(b("ov-tpt", C.tan), [t.point], "circle"));
    }
    if (inter && inter.ok) out.push(markersItem(b("ov-inter", C.inter), inter.v.points, "circle"));
    if (integral && integral.ok && item && an) {
      const f1 = compile(an.expr, [an.v], { params: an.params });
      let f2: ((x: number) => number) | null = null;
      if (integral.v.mode === "area" && item2e) {
        const g = compile(inV(item2e, an.v), [an.v], { params: an.params });
        f2 = (x) => g(x);
      }
      const lo = Number(compile(integral.v.a, [], { params: an.params })());
      const hi = Number(compile(integral.v.b, [], { params: an.params })());
      if (Number.isFinite(lo) && Number.isFinite(hi)) out.push(areaItem(b("ov-area", item.color), (x) => f1(x), f2, lo, hi));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis, show, deriv, tangent, inter, integral, item, item2, an]);

  const markers = useMemo<HoverMarker[]>(() => {
    const m: HoverMarker[] = [];
    for (const e of entries) if (e.pt) m.push({ x: e.pt.x, y: e.pt.y, label: `${e.title} ${plainPoint(e.pt)}`, color: KIND_COLOR[e.kind] });
    if (inter && inter.ok) for (const p of inter.v.points) m.push({ x: p.x, y: p.y, label: `Schnittpunkt ${plainPoint(p)}`, color: C.inter });
    if (tangent && tangent.ok) m.push({ x: tangent.v.point.x, y: tangent.v.point.y, label: `Berührpunkt ${plainPoint(tangent.v.point)}`, color: C.tan });
    return m;
  }, [entries, inter, tangent]);

  const allItems = useMemo(() => [...items, ...overlay], [items, overlay]);

  const onRange = (r: Ranges): void =>
    setVis((prev) =>
      (["xMin", "xMax", "yMin", "yMax"] as const).every((k) => Math.abs(prev[k] - r[k]) <= 1e-9 * (1 + Math.abs(r[k]))) ? prev : r
    );

  const onPick = (p: { x: number; y: number }): void => {
    setTx(String(Number(p.x.toFixed(2)) || 0));
    setTOn(true);
    setPicking(false);
  };

  const flag = (k: keyof typeof show) => (e: { target: { checked: boolean } }) => setShow((s) => ({ ...s, [k]: e.target.checked }));
  const num = (s: string): number | null => (s === "" ? null : Number(s));

  return (
    <div className="workspace">
      <div className="graph-col">
        <GraphView items={allItems} markers={markers} onRange={onRange} onPick={picking ? onPick : undefined} picking={picking} />
      </div>
      <button className="panel-toggle" onClick={() => setOpen(!open)}>{open ? "Analyse ▸" : "◂ Analyse"}</button>
      {open && (
        <aside className="analysis">
          <h2>Analyse</h2>
          {!item ? (
            <p className="note">Für die Analyse eine Funktion oder Kurve eingeben, z. B. <code>f(x)=x^3-3x</code>.</p>
          ) : (
            <>
              <label className="field">
                Funktion
                <select value={String(item.line)} onChange={(e: { target: { value: string } }) => setSel(num(e.target.value))}>
                  {curves.map((f) => (
                    <option key={f.line} value={String(f.line)}>Zeile {f.line + 1}: {lines[f.line]?.src ?? ""}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                zweite Kurve (Schnittpunkte, Fläche)
                <select value={item2 ? String(item2.line) : ""} onChange={(e: { target: { value: string } }) => setSel2(num(e.target.value))}>
                  <option value="">– keine –</option>
                  {curves.filter((f) => f !== item).map((f) => (
                    <option key={f.line} value={String(f.line)}>Zeile {f.line + 1}: {lines[f.line]?.src ?? ""}</option>
                  ))}
                </select>
              </label>

              {!an && <p className="note">Funktionsanalyse (Nullstellen, Extrema, Tangente, Integral) gibt es nur für explizite Funktionen y = f(x). Schnittpunkte funktionieren auch mit impliziten Kurven.</p>}
              {an && (<>
              <div className="checks">
                <label><input type="checkbox" checked={show.roots} onChange={flag("roots")} /> Nullstellen</label>
                <label><input type="checkbox" checked={show.extrema} onChange={flag("extrema")} /> Extrema</label>
                <label><input type="checkbox" checked={show.inflections} onChange={flag("inflections")} /> Wendepunkte</label>
                <label><input type="checkbox" checked={show.asymptotes} onChange={flag("asymptotes")} /> Asymptoten</label>
                <label><input type="checkbox" checked={show.d1} onChange={flag("d1")} /> f′</label>
                <label><input type="checkbox" checked={show.d2} onChange={flag("d2")} /> f″</label>
              </div>

              {analysis && !analysis.ok && <p className="error">{analysis.msg}</p>}
              {analysis && analysis.ok && analysis.v.notes.map((n, i) => <p className="note" key={i}>{n}</p>)}
              {entries.length > 0 && (
                <ul className="results">
                  {entries.map((e, i) => (
                    <li key={i}>
                      <span className="tag" style={{ color: KIND_COLOR[e.kind] }}>{e.title}</span>
                      <Tex latex={e.latex} inline /> <Badge exact={e.exact} />
                      {e.guess && <span className="guess"> vermutlich <Tex latex={e.guess} inline /></span>}
                      <AddBtn onClick={() => onAddLine(e.line)} />
                    </li>
                  ))}
                </ul>
              )}
              {analysis && analysis.ok && entries.length === 0 && <p className="note">Im sichtbaren Bereich nichts gefunden.</p>}

              {deriv && !deriv.ok && <p className="error">Ableitung: {deriv.msg}</p>}
              {deriv && deriv.ok && (
                <ul className="results">
                  {show.d1 && (
                    <li><span className="tag">f′(x)</span><Tex latex={toLatex(deriv.v.d1)} inline /> <Badge exact /><AddBtn onClick={() => onAddLine(`y=${toLatex(deriv.v.d1)}`)} /></li>
                  )}
                  {show.d2 && (
                    <li><span className="tag">f″(x)</span><Tex latex={toLatex(deriv.v.d2)} inline /> <Badge exact /><AddBtn onClick={() => onAddLine(`y=${toLatex(deriv.v.d2)}`)} /></li>
                  )}
                </ul>
              )}

              </>)}
              {an && (<>
              <h3>Tangente und Normale</h3>
              <div className="row">
                <label><input type="checkbox" checked={tOn} onChange={(e: { target: { checked: boolean } }) => setTOn(e.target.checked)} /> an der Stelle x =</label>
                <input className="num wide" value={tx} onChange={(e: { target: { value: string } }) => setTx(e.target.value)} placeholder="z. B. \frac{\pi}{4}" />
                <button className={picking ? "small-btn on" : "small-btn"} onClick={() => setPicking(!picking)}>im Graph wählen</button>
              </div>
              {tangent && !tangent.ok && <p className="error">{tangent.msg}</p>}
              {tangent && tangent.ok && (
                <ul className="results">
                  <li><span className="tag" style={{ color: C.tan }}>Berührpunkt</span><Tex latex={pointLatex(tangent.v.point)} inline /> <Badge exact={tangent.v.exact} /></li>
                  <li><span className="tag" style={{ color: C.tan }}>Tangente</span><Tex latex={toLatex(tangent.v.tangent)} inline /><AddBtn onClick={() => onAddLine(toLatex(tangent.v.tangent))} /></li>
                  <li><span className="tag" style={{ color: C.nor }}>Normale</span><Tex latex={toLatex(tangent.v.normal)} inline /><AddBtn onClick={() => onAddLine(toLatex(tangent.v.normal))} /></li>
                </ul>
              )}

              </>)}
              <h3>Schnittpunkte</h3>
              {!item2 ? (
                <p className="note">Zweite Kurve wählen.</p>
              ) : (
                <label><input type="checkbox" checked={interOn} onChange={(e: { target: { checked: boolean } }) => setInterOn(e.target.checked)} /> Schnittpunkte anzeigen</label>
              )}
              {inter && !inter.ok && <p className="error">{inter.msg}</p>}
              {inter && inter.ok && (
                <ul className="results">
                  {inter.v.all && <li>Die Kurven sind identisch.</li>}
                  {inter.v.points.map((p, i) => (
                    <li key={i}>
                      <span className="tag" style={{ color: C.inter }}>Schnittpunkt</span><Tex latex={pointLatex(p)} inline /> <Badge exact={p.exact} />
                      <AddBtn onClick={() => onAddLine(pointLine(p))} />
                    </li>
                  ))}
                  {!inter.v.all && inter.v.points.length === 0 && <li>Keine Schnittpunkte{inter.v.note ? "" : " gefunden"}.</li>}
                  {inter.v.note && <li className="note">{inter.v.note}</li>}
                </ul>
              )}

              {an && (<>
              <h3>Integral und Fläche</h3>
              <div className="row">
                <label><input type="checkbox" checked={intOn} onChange={(e: { target: { checked: boolean } }) => setIntOn(e.target.checked)} /> von</label>
                <input className="num wide" value={intA} onChange={(e: { target: { value: string } }) => setIntA(e.target.value)} />
                <span>bis</span>
                <input className="num wide" value={intB} onChange={(e: { target: { value: string } }) => setIntB(e.target.value)} />
              </div>
              <div className="row">
                <select value={intMode} onChange={(e: { target: { value: string } }) => setIntMode(e.target.value === "integral" ? "integral" : "area")}>
                  <option value="area">Fläche (Betrag){item2e ? " zwischen beiden Kurven" : " zur x-Achse"}</option>
                  <option value="integral">Integral ∫ f dx (mit Vorzeichen)</option>
                </select>
              </div>
              {integral && !integral.ok && <p className="error">{integral.msg}</p>}
              {integral && integral.ok && (
                <ul className="results">
                  <li>
                    <span className="tag">{integral.v.mode === "integral" ? "Integral" : "Fläche"}</span>
                    {integral.v.r.exact ? (
                      <>
                        <Tex latex={`${toLatex(integral.v.r.exact)}${integral.v.r.exact.t === "num" || integral.v.r.numeric === null ? "" : ` \\approx ${approx(integral.v.r.numeric)}`}`} inline /> <Badge exact />
                      </>
                    ) : integral.v.r.numeric !== null ? (
                      <>
                        <Tex latex={`\\approx ${approx(integral.v.r.numeric)}`} inline /> <Badge exact={false} />
                      </>
                    ) : (
                      <span className="error"> nicht berechenbar</span>
                    )}
                    {(integral.v.r.exact || integral.v.r.numeric !== null) && (
                      <AddBtn onClick={() => onAddLine(`A=${integral.v.r.exact ? toLatex(integral.v.r.exact) : numberToLatex(integral.v.r.numeric as number, 12)}`)} />
                    )}
                  </li>
                  {integral.v.r.F && integral.v.mode === "integral" && (
                    <li>
                      <span className="tag">Stammfunktion</span><Tex latex={`F(x) = ${toLatex(integral.v.r.F)} + C`} inline /> <Badge exact />
                      <AddBtn onClick={() => onAddLine(`y=${toLatex(integral.v.r.F as Expr)}`)} />
                    </li>
                  )}
                  {integral.v.r.notes.map((n, i) => <li className="note" key={i}>{n}</li>)}
                </ul>
              )}
              </>)}
            </>
          )}
        </aside>
      )}
    </div>
  );
}
