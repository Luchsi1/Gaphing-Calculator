import { useMemo } from "react";
import Tex from "./Tex.tsx";
import { computeSections } from "./analysis/sections.ts";

const Badge = ({ exact }: { exact: boolean }) => (
  <span className={exact ? "badge exact" : "badge approx"}>{exact ? "exakt" : "Näherung"}</span>
);

/** Gleichungen, Systeme (eine Gleichung je Zeile) und Stammfunktionen. */
export default function SolveSections({ src, range }: { src: string; range: [number, number] }) {
  const sections = useMemo(() => computeSections(src, range), [src, range]);
  return (
    <>
      {sections.map((s, i) => (
        <section key={i}>
          <h2>{s.title}</h2>
          {s.error && <p className="error">{s.error}</p>}
          {s.items.map((it, j) => (
            <div key={j} className="solution">
              <Tex latex={it.latex} inline /> <Badge exact={it.exact} />
              {it.note && <span className="note"> {it.note}</span>}
            </div>
          ))}
          {s.notes.map((n, j) => <p className="note" key={j}>{n}</p>)}
        </section>
      ))}
    </>
  );
}
