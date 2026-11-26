import test from "node:test";
import assert from "node:assert/strict";
import {
  type Construction, type Def, emptyConstruction, addObject, removeObject, movePoint, dependents, find, toggleHidden,
} from "../src/geometry/model.ts";
import { evaluate, describe, rawIntersections, type Values, type PointVal, type LineVal } from "../src/geometry/compute.ts";
import { applyPick, TOOLS, type Tool } from "../src/geometry/tools.ts";
import { renderGeometry, hitTest, clipLineToView } from "../src/geometry/render.ts";
import { defaultView } from "../src/graph/viewport.ts";

// ---------- Hilfen ----------
class B {
  c: Construction = emptyConstruction();
  add(d: Def): string {
    const r = addObject(this.c, d);
    this.c = r.c;
    return r.id;
  }
  pt(x: number, y: number): string {
    return this.add({ k: "point", x, y });
  }
  move(id: string, x: number, y: number): void {
    this.c = movePoint(this.c, id, x, y);
  }
  get v(): Values {
    return evaluate(this.c);
  }
}

const P = (v: Values, id: string): PointVal => {
  const x = v[id];
  assert.ok(x && x.t === "point", `Punkt ${id} erwartet`);
  return x;
};
const L = (v: Values, id: string): LineVal => {
  const x = v[id];
  assert.ok(x && (x.t === "line" || x.t === "segment" || x.t === "ray" || x.t === "vector"), `Linie ${id} erwartet`);
  return x;
};
const near = (a: number, b: number, eps = 1e-9, msg = ""): void => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} != ${b}`);
const distToLine = (l: LineVal, x: number, y: number): number => Math.abs((x - l.px) * l.dy - (y - l.py) * l.dx);

// deterministischer Zufall
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------- Modell ----------
test("Geometrie: Namen, Verweise und Validierung", () => {
  const b = new B();
  const a = b.pt(0, 0);
  const p = b.pt(1, 0);
  const s = b.add({ k: "segment", a, b: p });
  assert.deepEqual(b.c.objects.map((o) => o.name), ["A", "B", "a"]);
  assert.throws(() => b.add({ k: "line", a, b: "zzz" }), /Unbekannt/);
  assert.throws(() => b.add({ k: "line", a, b: s }), /falsche Art/);
  assert.throws(() => b.add({ k: "polygon", pts: [a, p] }), /drei Punkte/);
  assert.throws(() => b.add({ k: "circler", c: a, r: -1 }), /Radius/);
  assert.throws(() => b.add({ k: "point", x: NaN, y: 0 }), /endlich/);
  assert.throws(() => b.add({ k: "intersect", a: s, b: s, n: 2 }), /Index/);
});

test("Geometrie: Löschen entfernt abhängige Objekte, Unabhängige bleiben", () => {
  const b = new B();
  const a = b.pt(0, 0);
  const p = b.pt(2, 0);
  const q = b.pt(0, 2);
  const m = b.add({ k: "midpoint", a, b: p });
  const l = b.add({ k: "line", a: m, b: q });
  const other = b.add({ k: "segment", a: p, b: q });
  assert.deepEqual(new Set(dependents(b.c, a)), new Set([m, l]));
  const c2 = removeObject(b.c, a);
  assert.deepEqual(c2.objects.map((o) => o.id), [p, q, other]);
  // Namen werden wiederverwendet
  const r = addObject(c2, { k: "point", x: 5, y: 5 });
  assert.equal(find(r.c, r.id)?.name, "A");
});

// ---------- Verschieben und Invarianten ----------
test("Geometrie: Verschieben eines Basispunkts verschiebt abhängige Punkte", () => {
  const b = new B();
  const a = b.pt(0, 0);
  const p = b.pt(4, 2);
  const m = b.add({ k: "midpoint", a, b: p });
  assert.deepEqual([P(b.v, m).x, P(b.v, m).y], [2, 1]);
  b.move(a, 2, 6);
  assert.deepEqual([P(b.v, m).x, P(b.v, m).y], [3, 4]);
  // abhängige Punkte sind nicht direkt verschiebbar
  const before = b.c;
  b.move(m, 100, 100);
  assert.equal(b.c, before.objects.length ? b.c : before);
  assert.deepEqual([P(b.v, m).x, P(b.v, m).y], [3, 4]);
});

test("Geometrie: Mittelsenkrechte bleibt senkrecht zur Strecke und geht durch deren Mitte (Zufall)", () => {
  const r = rng(7);
  for (let i = 0; i < 200; i++) {
    const b = new B();
    const a = b.pt(r() * 20 - 10, r() * 20 - 10);
    const p = b.pt(r() * 20 - 10, r() * 20 - 10);
    const pb = b.add({ k: "perpbis", a, b: p });
    const v = b.v;
    const A = P(v, a);
    const Bp = P(v, p);
    const l = L(v, pb);
    near(l.dx * (Bp.x - A.x) + l.dy * (Bp.y - A.y), 0, 1e-9, "senkrecht");
    near(distToLine(l, (A.x + Bp.x) / 2, (A.y + Bp.y) / 2), 0, 1e-9, "durch Mitte");
    // gleicher Abstand zu A und B für Punkte der Mittelsenkrechten
    const t = r() * 10 - 5;
    const x = l.px + t * l.dx;
    const y = l.py + t * l.dy;
    near(Math.hypot(x - A.x, y - A.y), Math.hypot(x - Bp.x, y - Bp.y), 1e-8, "äquidistant");
  }
});

test("Geometrie: Senkrechte und Parallele (Zufall)", () => {
  const r = rng(11);
  for (let i = 0; i < 200; i++) {
    const b = new B();
    const a = b.pt(r() * 10, r() * 10);
    const p = b.pt(r() * 10 + 11, r() * 10);
    const q = b.pt(r() * 10 - 5, r() * 10 - 5);
    const ab = b.add({ k: "line", a, b: p });
    const perp = b.add({ k: "perp", line: ab, p: q });
    const par = b.add({ k: "parallel", line: ab, p: q });
    const v = b.v;
    const base = L(v, ab);
    const lp = L(v, perp);
    const ll = L(v, par);
    near(base.dx * lp.dx + base.dy * lp.dy, 0, 1e-12, "Senkrechte");
    near(base.dx * ll.dy - base.dy * ll.dx, 0, 1e-12, "Parallele");
    near(distToLine(lp, P(v, q).x, P(v, q).y), 0, 1e-9);
    near(distToLine(ll, P(v, q).x, P(v, q).y), 0, 1e-9);
  }
});

test("Geometrie: Senkrechte/Parallele zu Strecke und Vektor; Winkelhalbierende teilt den Winkel", () => {
  const r = rng(5);
  for (let i = 0; i < 100; i++) {
    const b = new B();
    const a = b.pt(r() * 10 - 5, r() * 10 - 5);
    const s = b.pt(r() * 10 - 5, r() * 10 - 5);
    const c = b.pt(r() * 10 - 5, r() * 10 - 5);
    const bis = b.add({ k: "anglebis", a, b: s, c });
    const v = b.v;
    const A = P(v, a);
    const S = P(v, s);
    const C = P(v, c);
    const l = L(v, bis);
    const ang = (x: number, y: number, ux: number, uy: number): number =>
      Math.acos(Math.max(-1, Math.min(1, (x * ux + y * uy) / (Math.hypot(x, y) * Math.hypot(ux, uy)))));
    const w1 = ang(A.x - S.x, A.y - S.y, l.dx, l.dy);
    const w2 = ang(C.x - S.x, C.y - S.y, l.dx, l.dy);
    near(w1, w2, 1e-9, "gleiche Winkel");
    near(l.px, S.x);
    near(l.py, S.y);
  }
  const b = new B();
  const p1 = b.pt(0, 0);
  const p2 = b.pt(4, 3);
  const seg = b.add({ k: "segment", a: p1, b: p2 });
  const vec = b.add({ k: "vector", a: p1, b: p2 });
  const q = b.pt(1, 5);
  const perpS = b.add({ k: "perp", line: seg, p: q });
  const parV = b.add({ k: "parallel", line: vec, p: q });
  const v = b.v;
  near(L(v, perpS).dx * 0.8 + L(v, perpS).dy * 0.6, 0);
  near(L(v, parV).dx, 0.8);
});

// ---------- Schnittpunkte ----------
test("Geometrie: Geradenschnitt exakt (Bruchkoordinaten) und liegt auf beiden Geraden", () => {
  const b = new B();
  const l1 = b.add({ k: "line", a: b.pt(0, 0), b: b.pt(3, 1) });
  const l2 = b.add({ k: "line", a: b.pt(0, 1), b: b.pt(1, 0) });
  const i = b.add({ k: "intersect", a: l1, b: l2, n: 0 });
  const v = b.v;
  const p = P(v, i);
  near(p.x, 0.75);
  near(p.y, 0.25);
  const o = find(b.c, i)!;
  assert.equal(describe(b.c, v, o), String.raw`E = \left(\frac{3}{4},\, \frac{1}{4}\right)`);
});

test("Geometrie: parallele Geraden schneiden sich nicht; Folgeobjekte sind undefiniert und erholen sich", () => {
  const b = new B();
  const a = b.pt(0, 0);
  const p = b.pt(1, 0);
  const q = b.pt(0, 1);
  const l1 = b.add({ k: "line", a, b: p });
  const l2 = b.add({ k: "parallel", line: l1, p: q });
  const i = b.add({ k: "intersect", a: l1, b: l2, n: 0 });
  const s = b.add({ k: "segment", a: i, b: q });
  assert.equal(b.v[i], null);
  assert.equal(b.v[s], null);
  b.move(q, 0, 1);
  assert.equal(b.v[i], null);
  // gleiche Punkte -> keine Gerade
  b.move(p, 0, 0);
  assert.equal(b.v[l1], null);
  assert.equal(b.v[l2], null);
  b.move(p, 5, 0);
  assert.ok(b.v[l1] && b.v[l2]);
});

test("Geometrie: Gerade–Kreis (zwei, ein, kein Schnittpunkt) mit stabilem Index", () => {
  const b = new B();
  const m = b.pt(0, 0);
  const ci = b.add({ k: "circle", c: m, p: b.pt(5, 0) });
  const a = b.pt(-10, 3);
  const p = b.pt(10, 3);
  const ln = b.add({ k: "line", a, b: p });
  const i0 = b.add({ k: "intersect", a: ln, b: ci, n: 0 });
  const i1 = b.add({ k: "intersect", a: ln, b: ci, n: 1 });
  let v = b.v;
  near(P(v, i0).x, -4);
  near(P(v, i1).x, 4);
  for (const id of [i0, i1]) {
    near(Math.hypot(P(v, id).x, P(v, id).y), 5);
    near(P(v, id).y, 3);
  }
  // Tangente
  b.move(a, -10, 5);
  b.move(p, 10, 5);
  v = b.v;
  near(P(v, i0).x, 0, 1e-6);
  assert.equal(v[i1], null);
  // keine Schnittpunkte
  b.move(a, -10, 6);
  b.move(p, 10, 6);
  v = b.v;
  assert.equal(v[i0], null);
  assert.equal(v[i1], null);
  // Reihenfolge entlang der Gerade bleibt beim Verschieben erhalten
  b.move(a, -10, 0);
  b.move(p, 10, 1);
  v = b.v;
  assert.ok(P(v, i0).x < P(v, i1).x);
});

test("Geometrie: Strecken und Strahlen schneiden nur im Bereich", () => {
  const b = new B();
  const m = b.pt(0, 0);
  const ci = b.add({ k: "circle", c: m, p: b.pt(5, 0) });
  const a = b.pt(0, 0);
  const p = b.pt(10, 0);
  const seg = b.add({ k: "segment", a, b: p });
  const ray = b.add({ k: "ray", a: b.pt(7, 0), b: b.pt(8, 0) });
  const i0 = b.add({ k: "intersect", a: seg, b: ci, n: 0 });
  const i1 = b.add({ k: "intersect", a: seg, b: ci, n: 1 });
  const j0 = b.add({ k: "intersect", a: ray, b: ci, n: 0 });
  const j1 = b.add({ k: "intersect", a: ray, b: ci, n: 1 });
  const v = b.v;
  assert.equal(v[i0], null); // (-5,0) liegt außerhalb der Strecke
  near(P(v, i1).x, 5);
  assert.equal(v[j0], null); // Strahl startet außerhalb des Kreises
  assert.equal(v[j1], null);
});

test("Geometrie: Kreis–Kreis und Bogen", () => {
  const b = new B();
  const m1 = b.pt(0, 0);
  const m2 = b.pt(6, 0);
  const c1 = b.add({ k: "circle", c: m1, p: b.pt(5, 0) });
  const c2 = b.add({ k: "circle", c: m2, p: b.pt(11, 0) });
  const i0 = b.add({ k: "intersect", a: c1, b: c2, n: 0 });
  const i1 = b.add({ k: "intersect", a: c1, b: c2, n: 1 });
  const v = b.v;
  for (const id of [i0, i1]) {
    near(Math.hypot(P(v, id).x, P(v, id).y), 5);
    near(Math.hypot(P(v, id).x - 6, P(v, id).y), 5);
  }
  near(P(v, i0).x, 3);
  assert.ok(P(v, i0).y > 0 && P(v, i1).y < 0, "Index 0 liegt links der Verbindung M1→M2");
  // Bogen von (5,0) über oben bis (0,5): nur der obere Schnittpunkt (Index 0) kann darauf liegen
  const arc = b.add({ k: "arc", c: m1, s: b.pt(5, 0), e: b.pt(0, 5) });
  const k0 = b.add({ k: "intersect", a: arc, b: c2, n: 0 });
  const k1 = b.add({ k: "intersect", a: arc, b: c2, n: 1 });
  const w = b.v;
  assert.ok(w[k0] && P(w, k0).y > 0);
  assert.equal(w[k1], null);
  // Kreise ohne Schnitt
  b.move(m2, 20, 0);
  assert.equal(b.v[i0], null);
});

test("Geometrie: rawIntersections mit fehlenden Werten", () => {
  assert.deepEqual(rawIntersections(null, null), []);
});

// ---------- Messungen ----------
test("Geometrie: Abstand exakt als Wurzel, Umfang und Fläche exakt", () => {
  const b = new B();
  const a = b.pt(0, 0);
  const p = b.pt(2, 2);
  const c = b.pt(4, 0);
  const d = b.add({ k: "distance", a, b: p });
  const poly = b.add({ k: "polygon", pts: [a, p, c] });
  const ar = b.add({ k: "area", of: poly });
  const pe = b.add({ k: "perimeter", of: poly });
  const v = b.v;
  const m = (id: string) => {
    const x = v[id];
    assert.ok(x && x.t === "measure");
    return x;
  };
  near(m(d).value, 2 * Math.SQRT2);
  assert.ok(m(d).latex.includes(String.raw`2\sqrt{2}`));
  assert.ok(m(d).exact);
  near(m(ar).value, 4);
  assert.ok(m(ar).latex.endsWith("= 4"));
  near(m(pe).value, 4 + 4 * Math.SQRT2);
  assert.ok(m(pe).latex.includes(String.raw`4\sqrt{2}`));
  // Orientierung egal
  const b2 = new B();
  const poly2 = b2.add({ k: "polygon", pts: [b2.pt(0, 0), b2.pt(0, 3), b2.pt(5, 0)] });
  const ar2 = b2.add({ k: "area", of: poly2 });
  const x = b2.v[ar2];
  assert.ok(x && x.t === "measure");
  near(x.value, 7.5);
  assert.ok(x.latex.includes(String.raw`\frac{15}{2}`));
});

test("Geometrie: Abstand mit krummen Koordinaten ist nur numerisch", () => {
  const b = new B();
  const a = b.pt(0, 0);
  const p = b.pt(1 / 3, 1 / 7);
  const d = b.add({ k: "distance", a, b: p });
  const x = b.v[d];
  assert.ok(x && x.t === "measure");
  assert.equal(x.exact, false);
  assert.ok(x.latex.includes(String.raw`\approx`));
  near(x.value, Math.hypot(1 / 3, 1 / 7));
});

test("Geometrie: Kreis – Fläche 8π, Umfang, Radius-Kreis", () => {
  const b = new B();
  const m = b.pt(1, 2);
  const c = b.add({ k: "circle", c: m, p: b.pt(3, 4) });
  const cr = b.add({ k: "circler", c: m, r: 3 });
  const a1 = b.add({ k: "area", of: c });
  const u1 = b.add({ k: "perimeter", of: c });
  const a2 = b.add({ k: "area", of: cr });
  const u2 = b.add({ k: "perimeter", of: cr });
  const v = b.v;
  const mv = (id: string) => {
    const x = v[id];
    assert.ok(x && x.t === "measure");
    return x;
  };
  near(mv(a1).value, 8 * Math.PI);
  assert.ok(mv(a1).latex.includes(String.raw`8\pi`));
  near(mv(u1).value, 4 * Math.SQRT2 * Math.PI);
  near(mv(a2).value, 9 * Math.PI);
  assert.ok(mv(a2).latex.includes(String.raw`9\pi`));
  assert.ok(mv(u2).latex.includes(String.raw`6\pi`));
  assert.equal(describe(b.c, v, find(b.c, c)!), String.raw`a:\ \left(x - 1\right)^{2} + \left(y - 2\right)^{2} = 8`);
  assert.equal(describe(b.c, v, find(b.c, cr)!), String.raw`b:\ \left(x - 1\right)^{2} + \left(y - 2\right)^{2} = 9`);
});

test("Geometrie: Winkel – exakte Gradzahlen, arccos sonst", () => {
  const cases: [number[], number[], number[], string | RegExp][] = [
    [[1, 0], [0, 0], [0, 1], "= 90^\\circ"],
    [[1, 0], [0, 0], [1, 1], "= 45^\\circ"],
    [[1, 0], [0, 0], [-1, 0], "= 180^\\circ"],
    [[2, 0], [0, 0], [1, 2], /\\arccos/],
  ];
  for (const [a, s, c, want] of cases) {
    const b = new B();
    const id = b.add({ k: "angle", a: b.pt(a[0], a[1]), b: b.pt(s[0], s[1]), c: b.pt(c[0], c[1]) });
    const x = b.v[id];
    assert.ok(x && x.t === "measure");
    if (typeof want === "string") assert.ok(x.latex.includes(want), x.latex);
    else assert.match(x.latex, want);
  }
  const b = new B();
  const id = b.add({ k: "angle", a: b.pt(3, 0), b: b.pt(0, 0), c: b.pt(0, 3) });
  const x = b.v[id];
  assert.ok(x && x.t === "measure");
  near(x.value, 90);
  // Winkelsumme im Dreieck (Zufall)
  const r = rng(3);
  for (let i = 0; i < 100; i++) {
    const t = new B();
    const A = t.pt(r() * 10, r() * 10);
    const Bq = t.pt(r() * 10 + 12, r() * 10);
    const C = t.pt(r() * 10 + 4, r() * 10 + 12);
    const a1 = t.add({ k: "angle", a: Bq, b: A, c: C });
    const a2 = t.add({ k: "angle", a: A, b: Bq, c: C });
    const a3 = t.add({ k: "angle", a: A, b: C, c: Bq });
    const v = t.v;
    const s = [a1, a2, a3].reduce((acc, id2) => {
      const m = v[id2];
      assert.ok(m && m.t === "measure");
      return acc + m.value;
    }, 0);
    near(s, 180, 1e-9);
  }
});

test("Geometrie: Geradengleichungen", () => {
  const b = new B();
  const l = b.add({ k: "line", a: b.pt(0, 1), b: b.pt(2, 5) });
  const h = b.add({ k: "line", a: b.pt(1, 3), b: b.pt(4, 3) });
  const vv = b.add({ k: "line", a: b.pt(2, 0), b: b.pt(2, 7) });
  const n = b.add({ k: "line", a: b.pt(0.1 / 3, 0), b: b.pt(1, 1 / 7) });
  const v = b.v;
  assert.equal(describe(b.c, v, find(b.c, l)!), String.raw`a:\ 2x - y = -1`);
  assert.equal(describe(b.c, v, find(b.c, h)!), String.raw`b:\ y = 3`);
  assert.equal(describe(b.c, v, find(b.c, vv)!), String.raw`c:\ x = 2`);
  assert.ok(describe(b.c, v, find(b.c, n)!)?.includes("="));
});

// ---------- Werkzeuge ----------
function clicks(tool: Tool, targets: Parameters<typeof applyPick>[3][], c0 = emptyConstruction(), radius = 1) {
  let c = c0;
  let picks: string[] = [];
  const created: string[] = [];
  const messages: string[] = [];
  for (const t of targets) {
    const r = applyPick(c, tool, picks, t, { radius });
    c = r.c;
    picks = r.picks;
    created.push(...r.created);
    if (r.message) messages.push(r.message);
  }
  return { c, picks, created, messages };
}
const E = (x: number, y: number) => ({ type: "empty" as const, x, y });

test("Geometrie: Werkzeug Punkt/Strecke/Polygon mit Klicks auf leere Fläche", () => {
  let r = clicks("point", [E(1, 2), E(3, 4)]);
  assert.equal(r.c.objects.length, 2);
  r = clicks("segment", [E(0, 0), E(3, 4)]);
  assert.deepEqual(r.c.objects.map((o) => o.def.k), ["point", "point", "segment"]);
  assert.deepEqual(r.picks, []);
  // Polygon: drei Ecken, Schließen durch Klick auf die erste Ecke
  let c = emptyConstruction();
  let picks: string[] = [];
  for (const t of [E(0, 0), E(4, 0), E(0, 3)]) {
    const s = applyPick(c, "polygon", picks, t);
    c = s.c;
    picks = s.picks;
  }
  assert.equal(picks.length, 3);
  const s = applyPick(c, "polygon", picks, { type: "object", id: picks[0] });
  assert.equal(s.c.objects[s.c.objects.length - 1].def.k, "polygon");
  assert.deepEqual(s.picks, []);
  // Polygon mit nur 2 Ecken wird nicht geschlossen
  let c2 = emptyConstruction();
  let p2: string[] = [];
  for (const t of [E(0, 0), E(1, 0)]) {
    const q = applyPick(c2, "polygon", p2, t);
    c2 = q.c;
    p2 = q.picks;
  }
  const q = applyPick(c2, "polygon", p2, { type: "object", id: p2[0] });
  assert.equal(q.c.objects.some((o) => o.def.k === "polygon"), false);
});

test("Geometrie: Werkzeuge verwenden bestehende Punkte und lehnen falsche Ziele ab", () => {
  const b = new B();
  const a = b.pt(0, 0);
  const p = b.pt(2, 0);
  const seg = b.add({ k: "segment", a, b: p });
  // Gerade durch bestehende Punkte: keine neuen Punkte
  const r = clicks("line", [{ type: "object", id: a }, { type: "object", id: p }], b.c);
  assert.equal(r.c.objects.length, b.c.objects.length + 1);
  // Strecke ist als Punkt-Auswahl unzulässig
  const bad = clicks("line", [{ type: "object", id: seg }], b.c);
  assert.equal(bad.c, b.c);
  assert.ok(bad.messages.length === 1);
  // Mittelsenkrechte: zwei Klicks
  const pb = clicks("perpbis", [{ type: "object", id: a }, { type: "object", id: p }], b.c);
  assert.equal(pb.c.objects[pb.c.objects.length - 1].def.k, "perpbis");
  // Schnittpunkt-Werkzeug akzeptiert keine leere Fläche
  const x = clicks("intersect", [E(1, 1)], b.c);
  assert.equal(x.c, b.c);
});

test("Geometrie: Senkrechte/Parallele in beliebiger Reihenfolge; Abstand an Strecke", () => {
  const b = new B();
  const a = b.pt(0, 0);
  const p = b.pt(4, 0);
  const l = b.add({ k: "line", a, b: p });
  const q = b.pt(1, 3);
  for (const order of [[l, q], [q, l]]) {
    const r = clicks("perp", order.map((id) => ({ type: "object" as const, id })), b.c);
    const o = r.c.objects[r.c.objects.length - 1];
    assert.deepEqual(o.def, { k: "perp", line: l, p: q });
  }
  const seg = b.add({ k: "segment", a, b: p });
  const d = clicks("distance", [{ type: "object", id: seg }], b.c);
  assert.equal(d.c.objects[d.c.objects.length - 1].def.k, "distance");
  assert.deepEqual(d.picks, []);
  // Parallele mit zwei Geraden wäre unzulässig
  const l2 = b.add({ k: "line", a: q, b: p });
  const bad = clicks("parallel", [{ type: "object", id: l }, { type: "object", id: l2 }], b.c);
  assert.equal(bad.c, b.c);
});

test("Geometrie: Schnittpunkt-Werkzeug legt alle vorhandenen Schnittpunkte an", () => {
  const b = new B();
  const m = b.pt(0, 0);
  const ci = b.add({ k: "circle", c: m, p: b.pt(5, 0) });
  const ln = b.add({ k: "line", a: b.pt(-10, 3), b: b.pt(10, 3) });
  const r = clicks("intersect", [{ type: "object", id: ln }, { type: "object", id: ci }], b.c);
  assert.equal(r.created.length, 2);
  assert.ok(r.created.every((id) => find(r.c, id)?.def.k === "intersect"));
  const miss = b.add({ k: "line", a: b.pt(-10, 9), b: b.pt(10, 9) });
  const r2 = clicks("intersect", [{ type: "object", id: miss }, { type: "object", id: ci }], b.c);
  assert.equal(r2.created.length, 0);
  assert.ok(r2.messages[0].includes("nicht"));
});

test("Geometrie: Kreis mit Radius, Bogen, Fläche/Umfang per Werkzeug", () => {
  const r = clicks("circler", [E(1, 1)], emptyConstruction(), 2.5);
  assert.deepEqual(r.c.objects[r.c.objects.length - 1].def, { k: "circler", c: r.c.objects[0].id, r: 2.5 });
  const a = clicks("arc", [E(0, 0), E(3, 0), E(0, 3)]);
  assert.equal(a.c.objects[a.c.objects.length - 1].def.k, "arc");
  const b = new B();
  const poly = b.add({ k: "polygon", pts: [b.pt(0, 0), b.pt(2, 0), b.pt(0, 2)] });
  const f = clicks("area", [{ type: "object", id: poly }], b.c);
  const x = evaluate(f.c)[f.created[0]];
  assert.ok(x && x.t === "measure");
  near(x.value, 2);
  // alle Werkzeuge haben eine Beschreibung
  for (const t of Object.keys(TOOLS) as Tool[]) assert.ok(TOOLS[t].label && TOOLS[t].hint);
});

// ---------- Darstellung ----------
test("Geometrie: Zeichnen – Gerade wird auf das Fenster geschnitten", () => {
  const b = new B();
  const l = b.add({ k: "line", a: b.pt(0, 0), b: b.pt(1, 1) });
  const v = defaultView(800, 500);
  const seg = clipLineToView(v, L(b.v, l));
  assert.ok(seg);
  for (let i = 0; i < 4; i += 2) {
    assert.ok(seg[i] >= -5 && seg[i] <= 805);
    assert.ok(seg[i + 1] >= -5 && seg[i + 1] <= 505);
  }
  // außerhalb: keine Linie
  const far = b.add({ k: "line", a: b.pt(1000, 0), b: b.pt(1000, 1) });
  assert.equal(clipLineToView(v, L(b.v, far)), null);
  // Strecke außerhalb des Fensters
  const s2 = b.add({ k: "segment", a: b.pt(100, 100), b: b.pt(101, 101) });
  assert.equal(clipLineToView(v, L(b.v, s2)), null);
});

test("Geometrie: Szene enthält Shapes, Beschriftungen, Auswahl; Treffer bevorzugen Punkte", () => {
  const b = new B();
  const a = b.pt(0, 0);
  const p = b.pt(2, 0);
  const seg = b.add({ k: "segment", a, b: p });
  const ci = b.add({ k: "circle", c: a, p });
  const d = b.add({ k: "distance", a, b: p });
  const poly = b.add({ k: "polygon", pts: [a, p, b.pt(0, 2)] });
  const v = defaultView(800, 500);
  const vals = b.v;
  const scene = renderGeometry(b.c, vals, v, new Set([a, seg]));
  assert.ok(scene.items.length >= 5);
  assert.ok(scene.labels.some((l) => l.text === "A") && scene.labels.some((l) => l.text.startsWith("|AB|")));
  assert.equal(scene.halos.length, 2);
  for (const it of scene.items)
    for (const s of it.shapes) {
      const nums = s.type === "lines" ? s.lines.flat() : s.type === "points" ? s.pts : s.type === "fillPoly" ? s.polys.flat() : [];
      assert.ok(nums.every(Number.isFinite));
    }
  // Treffer: Punkt A hat Vorrang vor Strecke/Kreis an derselben Stelle
  const px = 400;
  const py = 250;
  assert.equal(hitTest(b.c, vals, v, px, py)[0], a);
  // Kreis wird am Rand getroffen
  const hits = hitTest(b.c, vals, v, 400 + 100, 250 - 3);
  assert.ok(hits.includes(ci) || hits.includes(p));
  assert.equal(hitTest(b.c, vals, v, 700, 450).length, 0);
  // ausgeblendete Objekte werden weder gezeichnet noch getroffen
  const hidden = toggleHidden(b.c, a);
  const sc2 = renderGeometry(hidden, evaluate(hidden), v, new Set());
  assert.ok(!sc2.labels.some((l) => l.text === "A"));
  assert.ok(!hitTest(hidden, evaluate(hidden), v, 400, 250).includes(a));
  void d;
  void poly;
});

test("Geometrie: riesige und winzige Kreise erzeugen endliche, begrenzte Polylinien", () => {
  for (const r of [1e-7, 1e-3, 1, 1e4, 1e8]) {
    const b = new B();
    const m = b.pt(0, 0);
    b.add({ k: "circle", c: m, p: b.pt(r, 0) });
    for (const zoom of [1, 40, 1e4]) {
      const v = { ...defaultView(800, 500), sx: zoom, sy: zoom };
      const scene = renderGeometry(b.c, b.v, v, new Set());
      for (const it of scene.items)
        for (const s of it.shapes)
          if (s.type === "lines") {
            for (const l of s.lines) {
              assert.ok(l.length <= 4010, `zu viele Punkte: ${l.length}`);
              assert.ok(l.every(Number.isFinite));
            }
          }
    }
  }
});

// ---------- Fuzz ----------
test("Geometrie: Zufallskonstruktionen werden ohne Fehler und ohne NaN ausgewertet", () => {
  const r = rng(99);
  for (let round = 0; round < 60; round++) {
    const b = new B();
    const pts: string[] = [];
    for (let i = 0; i < 4; i++) pts.push(b.pt(Math.round(r() * 8 - 4), Math.round(r() * 8 - 4)));
    const curves: string[] = [];
    for (let step = 0; step < 25; step++) {
      const pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
      const kind = Math.floor(r() * 12);
      try {
        switch (kind) {
          case 0: pts.push(b.pt(r() * 8 - 4, r() * 8 - 4)); break;
          case 1: pts.push(b.add({ k: "midpoint", a: pick(pts), b: pick(pts) })); break;
          case 2: curves.push(b.add({ k: "line", a: pick(pts), b: pick(pts) })); break;
          case 3: curves.push(b.add({ k: "segment", a: pick(pts), b: pick(pts) })); break;
          case 4: curves.push(b.add({ k: "ray", a: pick(pts), b: pick(pts) })); break;
          case 5: curves.push(b.add({ k: "circle", c: pick(pts), p: pick(pts) })); break;
          case 6: curves.push(b.add({ k: "perpbis", a: pick(pts), b: pick(pts) })); break;
          case 7: curves.push(b.add({ k: "perp", line: pick(curves.filter((id) => find(b.c, id)!.def.k !== "circle" && find(b.c, id)!.def.k !== "arc")), p: pick(pts) })); break;
          case 8: curves.push(b.add({ k: "anglebis", a: pick(pts), b: pick(pts), c: pick(pts) })); break;
          case 9: pts.push(b.add({ k: "intersect", a: pick(curves), b: pick(curves), n: Math.floor(r() * 2) })); break;
          case 10: b.add({ k: "angle", a: pick(pts), b: pick(pts), c: pick(pts) }); break;
          default: b.add({ k: "polygon", pts: [pick(pts), pick(pts), pick(pts)] });
        }
      } catch {
        /* ungültige Zufallswahl (z. B. leere Auswahl) – überspringen */
      }
    }
    const check = (): void => {
      const vals = b.v;
      for (const o of b.c.objects) {
        const x = vals[o.id];
        if (!x) continue;
        const nums: number[] =
          x.t === "point" ? [x.x, x.y] :
          x.t === "measure" ? [x.value] :
          x.t === "circle" ? [x.cx, x.cy, x.r] :
          x.t === "polygon" ? x.pts.flatMap((p) => [p.x, p.y]) :
          x.t === "arc" ? [x.cx, x.cy, x.r, x.a0, x.sweep] :
          [x.px, x.py, x.dx, x.dy];
        assert.ok(nums.every(Number.isFinite), `${o.name} (${o.def.k}) hat nicht endliche Werte`);
        describe(b.c, vals, o);
      }
      renderGeometry(b.c, vals, defaultView(800, 500), new Set());
    };
    check();
    // Verschieben aller freien Punkte und erneut prüfen
    for (const o of b.c.objects) if (o.def.k === "point") b.move(o.id, r() * 10 - 5, r() * 10 - 5);
    check();
    // Löschen des ersten Punkts lässt eine gültige Konstruktion zurück
    b.c = removeObject(b.c, b.c.objects[0].id);
    check();
  }
});
