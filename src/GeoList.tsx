import { useMemo } from "react";
import Tex from "./Tex.tsx";
import { type Construction, kindOf, removeObject, toggleHidden } from "./geometry/model.ts";
import { type Values, describe } from "./geometry/compute.ts";
import { GEO_COLORS } from "./geometry/render.ts";
import { type History, commit, exampleConstruction } from "./geometry/history.ts";

interface Props {
  history: History;
  setHistory: (f: (h: History) => History) => void;
  vals: Values;
  selected: string[];
  setSelected: (s: string[] | ((p: string[]) => string[])) => void;
}

/** Liste der Geometrie-Objekte (Koordinaten, Gleichungen, Maße als LaTeX) im linken Panel. */
export default function GeoList({ history, setHistory, vals, selected, setSelected }: Props) {
  const c: Construction = history.present;
  const rows = useMemo(() => c.objects.map((o) => ({ o, tex: describe(c, vals, o), defined: vals[o.id] !== null })), [c, vals]);

  return (
    <div className="geo-objects">
      <h1>Geometrie-Objekte</h1>
      {rows.length === 0 && (
        <div>
          <p className="note">Noch nichts konstruiert. Wähle im Graphen ein Geometrie-Werkzeug und klicke in die Zeichenfläche.</p>
          <button className="small-btn" onClick={() => setHistory((h) => commit(h, exampleConstruction()))}>Beispiel laden (Umkreis)</button>
        </div>
      )}
      <ul className="geo-list">
        {rows.map(({ o, tex, defined }) => (
          <li key={o.id} className={(selected.includes(o.id) ? "sel " : "") + (o.hidden ? "dim" : "")} onClick={() => setSelected([o.id])}>
            <span className="swatch" style={{ background: GEO_COLORS[kindOf(o.def)] }} />
            <div className="body">
              {!defined ? <span className="note">{o.name}: nicht definiert</span> : tex ? <Tex latex={tex} inline /> : <code>{o.name}</code>}
            </div>
            <button
              className="small-btn"
              title={o.hidden ? "Einblenden" : "Ausblenden"}
              onClick={(e: { stopPropagation: () => void }) => {
                e.stopPropagation();
                setHistory((h) => commit(h, toggleHidden(h.present, o.id)));
              }}
            >
              {o.hidden ? "○" : "●"}
            </button>
            <button
              className="small-btn"
              title="Löschen (mit abhängigen Objekten)"
              onClick={(e: { stopPropagation: () => void }) => {
                e.stopPropagation();
                setHistory((h) => commit(h, removeObject(h.present, o.id)));
                setSelected((s) => s.filter((x) => x !== o.id));
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
