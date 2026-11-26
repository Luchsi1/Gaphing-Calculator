// Werkzeuge: eine kleine Zustandsmaschine „Klick auf Ziel -> Auswahl -> fertiges Objekt“. Reine Logik, ohne UI.
import {
  type Construction, type Kind, type Def, addObject, find, kindOf, wantAccepts, type Want,
} from "./model.ts";
import { evaluate, rawIntersections } from "./compute.ts";

export type Tool =
  | "move" | "point" | "line" | "segment" | "ray" | "circle" | "circler" | "arc" | "polygon" | "vector"
  | "midpoint" | "intersect" | "perp" | "parallel" | "perpbis" | "anglebis"
  | "distance" | "angle" | "area" | "perimeter";

export interface ToolSpec {
  label: string;
  hint: string;
  group: "Zeichnen" | "Konstruieren" | "Messen";
  /** Erwartete Auswahl der Reihe nach; bei unordered in beliebiger Reihenfolge. */
  slots: Want[];
  unordered?: boolean;
}

export const TOOLS: Record<Tool, ToolSpec> = {
  move: { label: "Bewegen", hint: "Freie Punkte ziehen; Klick wählt Objekte aus.", group: "Zeichnen", slots: [] },
  point: { label: "Punkt", hint: "Klicke, um einen Punkt zu setzen.", group: "Zeichnen", slots: [] },
  line: { label: "Gerade", hint: "Zwei Punkte wählen oder setzen.", group: "Zeichnen", slots: ["point", "point"] },
  segment: { label: "Strecke", hint: "Zwei Punkte wählen oder setzen.", group: "Zeichnen", slots: ["point", "point"] },
  ray: { label: "Strahl", hint: "Anfangspunkt, dann ein Punkt auf dem Strahl.", group: "Zeichnen", slots: ["point", "point"] },
  vector: { label: "Vektor", hint: "Anfangs- und Endpunkt.", group: "Zeichnen", slots: ["point", "point"] },
  circle: { label: "Kreis", hint: "Mittelpunkt, dann ein Punkt auf dem Kreis.", group: "Zeichnen", slots: ["point", "point"] },
  circler: { label: "Kreis (Radius)", hint: "Mittelpunkt wählen; der Radius steht darüber.", group: "Zeichnen", slots: ["point"] },
  arc: { label: "Bogen", hint: "Mittelpunkt, Startpunkt, dann Endrichtung (gegen den Uhrzeigersinn).", group: "Zeichnen", slots: ["point", "point", "point"] },
  polygon: { label: "Polygon", hint: "Ecken nacheinander wählen; zum Schließen die erste Ecke erneut anklicken.", group: "Zeichnen", slots: [] },
  midpoint: { label: "Mittelpunkt", hint: "Zwei Punkte wählen.", group: "Konstruieren", slots: ["point", "point"] },
  intersect: { label: "Schnittpunkt", hint: "Zwei Objekte (Gerade, Strecke, Strahl, Kreis, Bogen) wählen.", group: "Konstruieren", slots: ["curve", "curve"] },
  perp: { label: "Senkrechte", hint: "Gerade (oder Strecke) und einen Punkt wählen.", group: "Konstruieren", slots: ["dir", "point"], unordered: true },
  parallel: { label: "Parallele", hint: "Gerade (oder Strecke) und einen Punkt wählen.", group: "Konstruieren", slots: ["dir", "point"], unordered: true },
  perpbis: { label: "Mittelsenkrechte", hint: "Zwei Punkte wählen.", group: "Konstruieren", slots: ["point", "point"] },
  anglebis: { label: "Winkelhalbierende", hint: "Drei Punkte: Schenkelpunkt, Scheitel, Schenkelpunkt.", group: "Konstruieren", slots: ["point", "point", "point"] },
  distance: { label: "Abstand", hint: "Zwei Punkte oder eine Strecke wählen.", group: "Messen", slots: ["point", "point"] },
  angle: { label: "Winkel", hint: "Drei Punkte: Schenkelpunkt, Scheitel, Schenkelpunkt.", group: "Messen", slots: ["point", "point", "point"] },
  area: { label: "Fläche", hint: "Polygon oder Kreis wählen.", group: "Messen", slots: ["area"] },
  perimeter: { label: "Umfang", hint: "Polygon oder Kreis wählen.", group: "Messen", slots: ["area"] },
};

export type Target = { type: "object"; id: string } | { type: "empty"; x: number; y: number };

export interface PickResult {
  c: Construction;
  picks: string[];
  /** neu erzeugte Objekte (zum Auswählen/Hervorheben) */
  created: string[];
  message?: string;
}

export interface ToolOptions {
  radius: number;
}

/** Aus den gesammelten Auswahlen die Definitionen der neuen Objekte bauen (ohne Schnittpunkte; die brauchen die Auswertung). */
function defsFor(tool: Tool, p: string[], opts: ToolOptions): Def[] {
  switch (tool) {
    case "line": case "segment": case "ray": case "vector": case "midpoint": case "perpbis": case "distance":
      return [{ k: tool, a: p[0], b: p[1] }];
    case "circle": return [{ k: "circle", c: p[0], p: p[1] }];
    case "circler": return [{ k: "circler", c: p[0], r: opts.radius }];
    case "arc": return [{ k: "arc", c: p[0], s: p[1], e: p[2] }];
    case "anglebis": case "angle": return [{ k: tool, a: p[0], b: p[1], c: p[2] }];
    case "perp": case "parallel": return [{ k: tool, line: p[0], p: p[1] }];
    case "area": case "perimeter": return [{ k: tool, of: p[0] }];
    default: return [];
  }
}

const kindToWant = (k: Kind): Want[] => (["point", "dir", "curve", "area"] as Want[]).filter((w) => wantAccepts(w, k));

/** Welche Slots des Werkzeugs sind für diese Auswahl noch frei und passen zu `kind`? */
function slotFor(spec: ToolSpec, pickKinds: Kind[], kind: Kind): number {
  const wants = kindToWant(kind);
  if (!spec.unordered) {
    const i = pickKinds.length;
    return i < spec.slots.length && wants.includes(spec.slots[i]) ? i : -1;
  }
  const used = new Set<number>();
  for (const k of pickKinds) {
    const j = spec.slots.findIndex((s, idx) => !used.has(idx) && kindToWant(k).includes(s));
    if (j >= 0) used.add(j);
  }
  return spec.slots.findIndex((s, idx) => !used.has(idx) && wants.includes(s));
}

/** Ordnet die Auswahl den Slots zu (bei unordered: Punkt/Linie in der Reihenfolge der Slots). */
function ordered(spec: ToolSpec, c: Construction, picks: string[]): string[] {
  if (!spec.unordered) return picks;
  const out: string[] = [];
  const left = [...picks];
  for (const s of spec.slots) {
    const i = left.findIndex((id) => {
      const o = find(c, id);
      return !!o && wantAccepts(s, kindOf(o.def));
    });
    if (i >= 0) out.push(...left.splice(i, 1));
  }
  return out;
}

export function applyPick(c0: Construction, tool: Tool, picks0: string[], target: Target, opts: ToolOptions = { radius: 1 }): PickResult {
  const spec = TOOLS[tool];
  let c = c0;
  const created: string[] = [];
  const add = (d: Def): string => {
    const r = addObject(c, d);
    c = r.c;
    created.push(r.id);
    return r.id;
  };

  if (tool === "move") return { c, picks: [], created };
  if (tool === "point") {
    if (target.type === "empty") add({ k: "point", x: target.x, y: target.y });
    return { c, picks: [], created };
  }

  // Ziel auf eine Objekt-ID abbilden
  let id: string | null = null;
  if (target.type === "object") {
    const o = find(c, target.id);
    if (!o) return { c: c0, picks: picks0, created: [] };
    id = o.id;
  }

  if (tool === "polygon") {
    if (id !== null) {
      const o = find(c, id);
      if (!o || kindOf(o.def) !== "point") return { c: c0, picks: picks0, created: [], message: "Für ein Polygon werden Punkte gebraucht." };
      if (id === picks0[0] && picks0.length >= 3) {
        add({ k: "polygon", pts: picks0 });
        return { c, picks: [], created };
      }
      if (picks0.includes(id)) return { c: c0, picks: picks0, created: [] };
      return { c, picks: [...picks0, id], created };
    }
    const pid = add({ k: "point", x: target.type === "empty" ? target.x : 0, y: target.type === "empty" ? target.y : 0 });
    return { c, picks: [...picks0, pid], created: [pid] };
  }

  // Abstand direkt an einer Strecke/einem Vektor
  if (tool === "distance" && id !== null && picks0.length === 0) {
    const o = find(c, id);
    if (o && (o.def.k === "segment" || o.def.k === "vector")) {
      add({ k: "distance", a: o.def.a, b: o.def.b });
      return { c, picks: [], created };
    }
  }

  const pickKinds = picks0.map((p) => kindOf((find(c, p) as { def: Def }).def));
  if (id === null) {
    // leere Fläche: nur dort einen Punkt anlegen, wo ein Punkt erwartet wird
    const t = target as { type: "empty"; x: number; y: number };
    if (slotFor(spec, pickKinds, "point") < 0) return { c: c0, picks: picks0, created: [], message: spec.hint };
    id = add({ k: "point", x: t.x, y: t.y });
  } else {
    const o = find(c, id);
    if (!o || slotFor(spec, pickKinds, kindOf(o.def)) < 0) return { c: c0, picks: picks0, created: [], message: spec.hint };
  }

  const picks = [...picks0, id];
  if (picks.length < spec.slots.length) return { c, picks, created };

  const done = ordered(spec, c, picks);
  if (tool === "intersect") {
    const vals = evaluate(c);
    const list = rawIntersections(vals[done[0]] ?? null, vals[done[1]] ?? null);
    list.forEach((p, n) => {
      if (p) add({ k: "intersect", a: done[0], b: done[1], n });
    });
    if (!created.some((cid) => find(c, cid)?.def.k === "intersect")) {
      return { c, picks: [], created, message: "Die Objekte schneiden sich nicht." };
    }
    return { c, picks: [], created };
  }
  for (const d of defsFor(tool, done, opts)) add(d);
  return { c, picks: [], created };
}
