// Verlauf (Rückgängig/Wiederholen) und Beispielkonstruktion. Reine Logik.
import { type Construction, type Def, emptyConstruction, addObject } from "./model.ts";

export interface History {
  past: Construction[];
  present: Construction;
  future: Construction[];
}

const LIMIT = 200;

export const initHistory = (c: Construction = emptyConstruction()): History => ({ past: [], present: c, future: [] });

/** Neuer Zustand als eigener Schritt (Rückgängig kehrt zum vorherigen zurück). */
export function commit(h: History, c: Construction): History {
  if (c === h.present) return h;
  return { past: [...h.past, h.present].slice(-LIMIT), present: c, future: [] };
}

/** Zustand ersetzen, ohne Schritt anzulegen (z. B. während des Ziehens eines Punkts). */
export const replace = (h: History, c: Construction): History => (c === h.present ? h : { ...h, present: c });

/** Aktuellen Zustand als Rückgängig-Schritt festhalten, ohne ihn zu ändern (Beginn einer Ziehbewegung). */
export const checkpoint = (h: History): History => ({ past: [...h.past, h.present].slice(-LIMIT), present: h.present, future: [] });

export function undo(h: History): History {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo(h: History): History {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}

/** Dreieck mit Mittelsenkrechten, Umkreis und Fläche – zeigt, dass Konstruktionen beim Ziehen konsistent bleiben. */
export function exampleConstruction(): Construction {
  let c = emptyConstruction();
  const add = (d: Def, name?: string): string => {
    const r = addObject(c, d, name);
    c = r.c;
    return r.id;
  };
  const A = add({ k: "point", x: -4, y: -2 });
  const B = add({ k: "point", x: 4, y: -2 });
  const C = add({ k: "point", x: 1, y: 4 });
  const tri = add({ k: "polygon", pts: [A, B, C] });
  const m1 = add({ k: "perpbis", a: A, b: B });
  const m2 = add({ k: "perpbis", a: B, b: C });
  const O = add({ k: "intersect", a: m1, b: m2, n: 0 }, "O");
  add({ k: "circle", c: O, p: A });
  add({ k: "area", of: tri });
  add({ k: "angle", a: A, b: C, c: B });
  return c;
}
