// Gleichungen, Gleichungssysteme (eine Gleichung je Zeile) und Stammfunktion für den Rechner – ohne UI.
import {
  parse, freeSymbols, solveEquation, solveSystem, antiderivative, toLatex, numberToLatex, add, mul, NEG1, type Expr,
} from "../engine/index.ts";

export interface Item {
  latex: string;
  exact: boolean;
  note?: string;
}
export interface Section {
  title: string;
  items: Item[];
  notes: string[];
  error?: string;
}

const VAR_ORDER = ["x", "y", "z", "t", "u", "v", "w"];
const orderVars = (s: Iterable<string>): string[] =>
  [...s].sort((a, b) => {
    const ia = VAR_ORDER.indexOf(a);
    const ib = VAR_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });

const mult = (m: number): string | undefined => (m === 2 ? "doppelte Lösung" : m === 3 ? "dreifache Lösung" : m > 3 ? `${m}-fache Lösung` : undefined);
const nameOf = (v: string): string => (v.length > 1 && !v.includes("_") ? `\\${v}` : v);

export function computeSections(src: string, range: [number, number] = [-10, 10]): Section[] {
  const exprs: Expr[] = [];
  for (const l of src.split("\n")) {
    if (!l.trim()) continue;
    try {
      exprs.push(parse(l));
    } catch {
      /* Fehler zeigt die Zeilenliste an */
    }
  }
  const isEq = (e: Expr): e is Extract<Expr, { t: "rel" }> => e.t === "rel" && e.ops.length === 1 && e.ops[0] === "=";
  const eqs = exprs.filter(isEq);
  const out: Section[] = [];
  const F = (e: Extract<Expr, { t: "rel" }>): Expr => add(e.args[0], mul(NEG1, e.args[1]));

  if (eqs.length >= 2) {
    const sec: Section = { title: "Gleichungssystem", items: [], notes: [] };
    out.push(sec);
    try {
      const vars = orderVars(new Set(eqs.flatMap((e) => [...freeSymbols(e)])));
      if (vars.length === 0) sec.notes.push("Keine Unbekannten");
      else {
        const r = solveSystem(eqs.map(F), vars, {}, range);
        if (r.note) sec.notes.push(r.note);
        if (r.kind === "unsupported" || r.kind === "none" || r.kind === "infinite") {
          if (!r.note) sec.notes.push("Keine eindeutige Lösung");
        }
        r.solutions.forEach((s) => {
          const parts = r.vars.map((v, i) => `${nameOf(v)} = ${s.exprs[i] ? toLatex(s.exprs[i] as Expr) : `\\approx ${numberToLatex(s.values[i], 8)}`}`);
          sec.items.push({ latex: parts.join(",\\quad "), exact: s.exact });
        });
      }
    } catch (e) {
      sec.error = e instanceof Error ? e.message : String(e);
    }
    return out;
  }

  const first = exprs[0];
  if (!first) return out;
  if (isEq(first)) {
    const free = freeSymbols(first);
    const sec: Section = { title: "Lösung der Gleichung", items: [], notes: [] };
    out.push(sec);
    if (free.size !== 1) {
      sec.notes.push(free.size === 0 ? "Die Gleichung enthält keine Unbekannte." : `Mehrere Unbekannte (${orderVars(free).join(", ")}): für ein System je Gleichung eine Zeile eingeben.`);
      return out;
    }
    const v = [...free][0];
    try {
      const r = solveEquation(first.args[0], first.args[1], v, {}, range);
      if (r.all) sec.items.push({ latex: `\\text{jedes } ${nameOf(v)} \\text{ ist Lösung}`, exact: true });
      else if (r.solutions.length === 0) sec.items.push({ latex: "\\text{keine reelle Lösung}", exact: r.exact || r.method !== "numeric" });
      for (const s of r.solutions) {
        sec.items.push({
          latex: `${nameOf(v)} = ${s.expr ? toLatex(s.expr) : `\\approx ${numberToLatex(s.value, 8)}`}`,
          exact: s.expr !== null,
          note: mult(s.mult),
        });
      }
      if (r.note) sec.notes.push(r.note);
    } catch (e) {
      sec.error = e instanceof Error ? e.message : String(e);
    }
    return out;
  }

  const free = freeSymbols(first);
  if (free.size === 1) {
    const v = [...free][0];
    const F0 = antiderivative(first, v);
    out.push({
      title: "Stammfunktion",
      items: F0 ? [{ latex: `\\int ${toLatex(first)} \\, d${nameOf(v)} = ${toLatex(F0)} + C`, exact: true }] : [],
      notes: F0 ? [] : ["Keine Stammfunktion in geschlossener Form gefunden (das Integral lässt sich numerisch auswerten)."],
    });
  }
  return out;
}

