import test from "node:test";
import assert from "node:assert/strict";
import { initHistory, commit, replace, checkpoint, undo, redo, exampleConstruction } from "../src/geometry/history.ts";
import { addObject, movePoint, emptyConstruction, find } from "../src/geometry/model.ts";
import { evaluate } from "../src/geometry/compute.ts";

test("Geometrie-Verlauf: Rückgängig/Wiederholen und Zusammenfassen von Ziehbewegungen", () => {
  let h = initHistory();
  const r = addObject(h.present, { k: "point", x: 0, y: 0 });
  h = commit(h, r.c);
  assert.equal(h.past.length, 1);
  // Ziehen: ein Checkpoint, viele Ersetzungen -> ein Rückgängig-Schritt
  h = checkpoint(h);
  for (let i = 1; i <= 20; i++) h = replace(h, movePoint(h.present, r.id, i, i));
  assert.equal(h.past.length, 2);
  h = undo(h);
  assert.deepEqual(find(h.present, r.id)!.def, { k: "point", x: 0, y: 0 });
  h = redo(h);
  assert.deepEqual(find(h.present, r.id)!.def, { k: "point", x: 20, y: 20 });
  // neue Aktion verwirft das Wiederholen
  h = undo(h);
  h = commit(h, addObject(h.present, { k: "point", x: 5, y: 5 }).c);
  assert.equal(h.future.length, 0);
  // Grenzen
  assert.equal(undo(initHistory()).past.length, 0);
  assert.equal(redo(initHistory()).future.length, 0);
  assert.equal(commit(h, h.present), h);
  assert.equal(initHistory().present.objects.length, emptyConstruction().objects.length);
});

test("Geometrie-Beispiel: Umkreismittelpunkt bleibt beim Ziehen gleich weit von A, B, C entfernt", () => {
  let c = exampleConstruction();
  const byName = (n: string) => c.objects.find((o) => o.name === n)!;
  const [A, B, C, O] = ["A", "B", "C", "O"].map((n) => byName(n).id);
  let seed = 1;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 100; i++) {
    c = movePoint(c, A, rnd() * 10 - 8, rnd() * 10 - 8);
    c = movePoint(c, B, rnd() * 10 + 1, rnd() * 10 - 8);
    c = movePoint(c, C, rnd() * 10 - 4, rnd() * 10 + 2);
    const v = evaluate(c);
    const pt = (id: string) => {
      const x = v[id];
      assert.ok(x && x.t === "point");
      return x;
    };
    const d = (p: string) => Math.hypot(pt(p).x - pt(O).x, pt(p).y - pt(O).y);
    assert.ok(Math.abs(d(A) - d(B)) < 1e-8 && Math.abs(d(B) - d(C)) < 1e-8);
  }
});
