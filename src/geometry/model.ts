// Konstruktions-DAG der Geometrie: freie Punkte und davon abhängige Objekte.
// Objekte stehen in Erstellungsreihenfolge im Array und dürfen nur auf frühere Objekte verweisen;
// die Reihenfolge ist damit automatisch eine topologische Ordnung (Neuberechnung von vorn nach hinten).

export type Def =
  | { k: "point"; x: number; y: number }
  | { k: "midpoint"; a: string; b: string }
  | { k: "intersect"; a: string; b: string; n: number }
  | { k: "line"; a: string; b: string }
  | { k: "segment"; a: string; b: string }
  | { k: "ray"; a: string; b: string }
  | { k: "vector"; a: string; b: string }
  | { k: "circle"; c: string; p: string }
  | { k: "circler"; c: string; r: number }
  | { k: "arc"; c: string; s: string; e: string }
  | { k: "polygon"; pts: string[] }
  | { k: "perp"; line: string; p: string }
  | { k: "parallel"; line: string; p: string }
  | { k: "perpbis"; a: string; b: string }
  | { k: "anglebis"; a: string; b: string; c: string }
  | { k: "distance"; a: string; b: string }
  | { k: "angle"; a: string; b: string; c: string }
  | { k: "area"; of: string }
  | { k: "perimeter"; of: string };

export type Kind = "point" | "line" | "segment" | "ray" | "vector" | "circle" | "arc" | "polygon" | "measure";

/** Welche Art von Objekt an einer Stelle der Definition erwartet wird. */
export type Want = "point" | "dir" | "curve" | "area";

export interface GObject {
  id: string;
  name: string;
  def: Def;
  hidden?: boolean;
}

export interface Construction {
  objects: GObject[];
  nextId: number;
}

export const emptyConstruction = (): Construction => ({ objects: [], nextId: 1 });

export function kindOf(d: Def): Kind {
  switch (d.k) {
    case "point": case "midpoint": case "intersect": return "point";
    case "line": case "perp": case "parallel": case "perpbis": case "anglebis": return "line";
    case "segment": return "segment";
    case "ray": return "ray";
    case "vector": return "vector";
    case "circle": case "circler": return "circle";
    case "arc": return "arc";
    case "polygon": return "polygon";
    default: return "measure";
  }
}

/** Alle Verweise einer Definition mit der erwarteten Objektart. */
export function refs(d: Def): { id: string; want: Want }[] {
  const P = (id: string): { id: string; want: Want } => ({ id, want: "point" });
  switch (d.k) {
    case "point": return [];
    case "midpoint": case "line": case "segment": case "ray": case "vector": case "perpbis": case "distance":
      return [P(d.a), P(d.b)];
    case "intersect": return [{ id: d.a, want: "curve" }, { id: d.b, want: "curve" }];
    case "circle": return [P(d.c), P(d.p)];
    case "circler": return [P(d.c)];
    case "arc": return [P(d.c), P(d.s), P(d.e)];
    case "polygon": return d.pts.map(P);
    case "perp": case "parallel": return [{ id: d.line, want: "dir" }, P(d.p)];
    case "anglebis": case "angle": return [P(d.a), P(d.b), P(d.c)];
    case "area": case "perimeter": return [{ id: d.of, want: "area" }];
  }
}

export const dependencies = (d: Def): string[] => refs(d).map((r) => r.id);

const WANT: Record<Want, Kind[]> = {
  point: ["point"],
  dir: ["line", "segment", "ray", "vector"],
  curve: ["line", "segment", "ray", "circle", "arc"],
  area: ["polygon", "circle"],
};

export const wantAccepts = (w: Want, k: Kind): boolean => WANT[w].includes(k);

export const find = (c: Construction, id: string): GObject | undefined => c.objects.find((o) => o.id === id);

export const isFreePoint = (o: GObject | undefined): boolean => !!o && o.def.k === "point";

/** Alle Objekte, die (direkt oder indirekt) von id abhängen. */
export function dependents(c: Construction, id: string): string[] {
  const gone = new Set<string>([id]);
  const out: string[] = [];
  for (const o of c.objects) {
    if (o.id === id) continue;
    if (dependencies(o.def).some((d) => gone.has(d))) {
      gone.add(o.id);
      out.push(o.id);
    }
  }
  return out;
}

const POINT_NAMES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const OTHER_NAMES = "abcdefghijklmnopqrstuvw";

/** Nächster freier Name: Punkte A, B, … Z, A_1, …; andere Objekte a, b, …; Messungen m_1, m_2, … */
export function freshName(c: Construction, kind: Kind): string {
  const used = new Set(c.objects.map((o) => o.name));
  if (kind === "measure") {
    for (let i = 1; ; i++) if (!used.has(`m_${i}`)) return `m_${i}`;
  }
  const letters = kind === "point" ? POINT_NAMES : OTHER_NAMES;
  for (let round = 0; ; round++) {
    for (const ch of letters) {
      const name = round === 0 ? ch : `${ch}_${round}`;
      if (!used.has(name)) return name;
    }
  }
}

function validate(c: Construction, d: Def): void {
  if (d.k === "point" && !(Number.isFinite(d.x) && Number.isFinite(d.y))) throw new Error("Punkt: Koordinaten müssen endlich sein");
  if (d.k === "circler" && !(Number.isFinite(d.r) && d.r > 0)) throw new Error("Kreis: Radius muss positiv sein");
  if (d.k === "polygon" && d.pts.length < 3) throw new Error("Polygon: mindestens drei Punkte");
  if (d.k === "intersect" && !(d.n === 0 || d.n === 1)) throw new Error("Schnittpunkt: Index muss 0 oder 1 sein");
  for (const r of refs(d)) {
    const o = find(c, r.id);
    if (!o) throw new Error(`Unbekanntes Objekt: ${r.id}`);
    if (!wantAccepts(r.want, kindOf(o.def))) throw new Error(`Objekt ${o.name} hat hier die falsche Art`);
  }
}

export function addObject(c: Construction, def: Def, name?: string): { c: Construction; id: string } {
  validate(c, def);
  const id = `o${c.nextId}`;
  const obj: GObject = { id, name: name && !c.objects.some((o) => o.name === name) ? name : freshName(c, kindOf(def)), def };
  return { c: { objects: [...c.objects, obj], nextId: c.nextId + 1 }, id };
}

/** Entfernt ein Objekt samt allem, was davon abhängt. */
export function removeObject(c: Construction, id: string): Construction {
  const drop = new Set([id, ...dependents(c, id)]);
  return { ...c, objects: c.objects.filter((o) => !drop.has(o.id)) };
}

/** Verschiebt einen freien Punkt; abhängige Objekte folgen bei der nächsten Auswertung. */
export function movePoint(c: Construction, id: string, x: number, y: number): Construction {
  if (!(Number.isFinite(x) && Number.isFinite(y))) return c;
  return { ...c, objects: c.objects.map((o) => (o.id === id && o.def.k === "point" ? { ...o, def: { k: "point", x, y } } : o)) };
}

export const toggleHidden = (c: Construction, id: string): Construction => ({
  ...c, objects: c.objects.map((o) => (o.id === id ? { ...o, hidden: !o.hidden } : o)),
});
