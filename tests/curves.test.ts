import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultView, xFromPx, yFromPx, type View } from "../src/graph/viewport.ts";
import { buildModel, type PlotModel } from "../src/graph/model.ts";
import type { Shape } from "../src/graph/items.ts";
import { createSlider, stepSlider, setSliderValue, configureSlider, sliderParams } from "../src/graph/sliders.ts";

const near = (a: number, b: number, tol = 1e-9): void =>
  assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);

const W = 800, H = 600;
const view = (): View => ({ ...defaultView(W, H), sx: 50, sy: 50 }); // x ∈ [-8,8], y ∈ [-6,6]

const itemOf = (m: PlotModel, line: number) => {
  const it = m.items.find((i) => i.line === line);
  assert.ok(it, `kein Objekt für Zeile ${line}: ${JSON.stringify(m.lines[line])}`);
  return it;
};
const shapes = (m: PlotModel, line: number, v = view()): Shape[] => itemOf(m, line).draw(v);
const linesOf = (sh: Shape[]): number[][] => sh.filter((s) => s.type === "lines").flatMap((s) => (s.type === "lines" ? s.lines : []));
const world = (v: View, px: number, py: number): [number, number] => [xFromPx(v, px), yFromPx(v, py)];

/** Anteil der Bildpunkte (Raster 10 px), die von den Füllformen überdeckt werden. */
function coverage(sh: Shape[], v: View): number {
  const inPoly = (p: number[], x: number, y: number): boolean => {
    let inside = false;
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
      const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  let hit = 0, total = 0;
  for (let y = 5; y < v.height; y += 10) {
    for (let x = 5; x < v.width; x += 10) {
      total++;
      let on = false;
      for (const s of sh) {
        if (s.type === "fillPoly" && s.polys.some((p) => inPoly(p, x, y))) on = true;
        if (s.type === "fillRects") {
          for (let i = 0; i < s.rects.length; i += 4) {
            if (x >= s.rects[i] && x < s.rects[i] + s.rects[i + 2] && y >= s.rects[i + 1] && y < s.rects[i + 1] + s.rects[i + 3]) on = true;
          }
        }
      }
      if (on) hit++;
    }
  }
  return hit / total;
}

test("Modell: Klassifikation aller Zeilenarten", () => {
  const m = buildModel([
    "f(x)=x^2", "a=3", "a x", "\\frac{d}{dx} f(x)", "f(2)+1", "y=\\sin(x)", "x^2+y^2=25", "b x", "\\frac{1}{", "",
    "(1,2)", "r=1+\\cos(\\theta)", "(\\cos t,\\sin t)\\left\\{0\\le t\\le 6\\right\\}", "y<x^2", "x^2+y^2\\le 4", "y=c x",
    "x^2\\left\\{x>0\\right\\}",
  ].join("\n"));
  const kinds = m.lines.map((l) => l.kind);
  assert.deepEqual(kinds, [
    "function", "parameter", "function", "function", "function", "function", "function", "pending", "error", "empty",
    "function", "function", "function", "function", "function", "pending", "function",
  ]);
  assert.deepEqual(m.lines.map((l) => l.shape ?? null), [
    "explicit", null, "explicit", "explicit", "explicit", "explicit", "implicit", null, null, null,
    "point", "polar", "parametric", "inequality", "inequality", null, "explicit",
  ]);
  assert.deepEqual(m.missing, ["b", "c"]);
  assert.deepEqual(m.lines[7].missing, ["b"]);
  assert.equal(m.params.a, 3);
  const p = (i: number) => itemOf(m, i).probe!;
  near(p(0)(3), 9);
  near(p(2)(2), 6);
  near(p(3)(3), 6);
  near(p(4)(0), 5);
  near(p(5)(Math.PI / 2), 1);
  near(p(16)(2), 4);
  assert.ok(Number.isNaN(p(16)(-2)));
  assert.equal(m.lines[8].pos !== undefined, true);
  // Slider-Werte füllen fehlende Parameter
  const m2 = buildModel("b x\ny=c x", { b: 2, c: 3 });
  assert.deepEqual(m2.missing, []);
  near(itemOf(m2, 0).probe!(4), 8);
});

test("Modell: Definitionen dürfen andere Definitionen aufrufen", () => {
  const m = buildModel("f(x)=x^2\ng(x)=f(x)+1\nh(x)=g(f(x))");
  assert.deepEqual(m.lines.map((l) => l.kind), ["function", "function", "function"]);
  near(itemOf(m, 1).probe!(3), 10);
  near(itemOf(m, 2).probe!(2), 17);
});

test("Modell: Zeilenparameter überschreiben Slider; rekursive Definition ist ein Fehler", () => {
  const m = buildModel("a=5\na x", { a: 1 });
  near(itemOf(m, 1).probe!(2), 10);
  const r = buildModel("f(x)=f(x)+1");
  assert.equal(r.lines[0].kind, "error");
  assert.equal(r.items.length, 0);
});

test("Implizite Kurve: Kreis ist eine geschlossene Linie auf dem Kreis", () => {
  const m = buildModel("x^2+y^2=25");
  const v = view();
  const lines = linesOf(shapes(m, 0, v));
  assert.equal(lines.length, 1);
  const l = lines[0];
  near(l[0], l[l.length - 2], 1e-9);
  near(l[1], l[l.length - 1], 1e-9);
  for (let i = 0; i < l.length; i += 2) {
    const [x, y] = world(v, l[i], l[i + 1]);
    assert.ok(Math.abs(Math.hypot(x, y) - 5) < 0.03, `r = ${Math.hypot(x, y)}`);
  }
});

test("Implizite Kurve: Hyperbel xy=1 (2 Äste), Gerade x=3, Polstellen ohne senkrechte Pseudolinien", () => {
  const v = view();
  assert.equal(linesOf(shapes(buildModel("x y=1"), 0, v)).length, 2);
  const line = linesOf(shapes(buildModel("x=3"), 0, v));
  assert.equal(line.length, 1);
  for (let i = 0; i < line[0].length; i += 2) near(world(v, line[0][i], 0)[0], 3, 0.01);
  // 2y = 2 tan(x): h hat Pole, die Höhenlinie darf sie nicht senkrecht überbrücken
  const t = linesOf(shapes(buildModel("2y=2\\tan(x)"), 0, v));
  assert.ok(t.length >= 4);
  for (const l of t) {
    const xs = l.filter((_, i) => i % 2 === 0), ys = l.filter((_, i) => i % 2 === 1);
    const dx = Math.max(...xs) - Math.min(...xs), dy = Math.max(...ys) - Math.min(...ys);
    assert.ok(!(dy > 100 && dx < 3), `senkrechte Pseudolinie dx=${dx} dy=${dy}`);
  }
});

test("Ungleichungen: Flächenanteile stimmen (exakter Pfad, Raster, Kette, Definitionsbereich)", () => {
  const v = view();
  const cov = (src: string): number => coverage(shapes(buildModel(src), 0, v), v);
  near(cov("y<x"), 0.5, 0.03);
  near(cov("y>x"), 0.5, 0.03);
  near(cov("x^2+y^2<25"), (Math.PI * 25) / 192, 0.03);
  near(cov("0<y<x"), 30 / 192, 0.03);
  near(cov("y<x\\left\\{x>0\\right\\}"), 78 / 192, 0.03);
  // strikte Ungleichung: gestrichelter Rand; ≤: durchgezogen
  const dashed = (src: string) => shapes(buildModel(src), 0, v).some((s) => s.type === "lines" && s.dashed);
  assert.equal(dashed("y<x"), true);
  assert.equal(dashed("y\\le x"), false);
  assert.equal(dashed("x^2+y^2<25"), true);
  assert.equal(dashed("x^2+y^2\\le 25"), false);
});

test("Parametrische Kurven: Kreis, Pol, Standardbereich, Punkt", () => {
  const v = view();
  const circle = linesOf(shapes(buildModel("(\\cos t,\\sin t)\\left\\{0\\le t\\le 2\\pi\\right\\}"), 0, v));
  assert.equal(circle.length, 1);
  const c = circle[0];
  assert.ok(c.length / 2 > 40 && c.length / 2 < 2000, `Punkte ${c.length / 2}`);
  for (let i = 0; i < c.length; i += 2) near(Math.hypot(c[i] - W / 2, c[i + 1] - H / 2), 50, 0.01);
  near(Math.hypot(c[0] - c[c.length - 2], c[1] - c[c.length - 1]), 0, 1e-6);
  assert.equal(linesOf(shapes(buildModel("(t,\\frac{1}{t})\\left\\{-5\\le t\\le 5\\right\\}"), 0, v)).length, 2);
  assert.equal(linesOf(shapes(buildModel("(t,t^2)"), 0, v)).length, 1);
  const pt = shapes(buildModel("(1,2)"), 0, v)[0];
  assert.equal(pt.type, "points");
  if (pt.type === "points") {
    near(pt.pts[0], W / 2 + 50);
    near(pt.pts[1], H / 2 - 100);
  }
  assert.equal(buildModel("(t,t^2)\\left\\{5\\le t\\le 1\\right\\}").lines[0].kind, "unsupported");
});

test("Polarkurven: Kardioide liegt auf r = 1 + cos θ, Spirale mit Standardbereich", () => {
  const v = view();
  const lines = linesOf(shapes(buildModel("r=1+\\cos(\\theta)\\left\\{0\\le\\theta\\le2\\pi\\right\\}"), 0, v));
  assert.equal(lines.length, 1);
  for (let i = 0; i < lines[0].length; i += 2) {
    const [x, y] = world(v, lines[0][i], lines[0][i + 1]);
    if (Math.hypot(x, y) < 0.05) continue; // Spitze im Ursprung: Winkel unbestimmt
    near(Math.hypot(x, y), 1 + Math.cos(Math.atan2(y, x)), 0.02);
  }
  const spiral = linesOf(shapes(buildModel("r=\\theta"), 0, v));
  assert.equal(spiral.length, 1);
  assert.ok(spiral[0].length / 2 > 100);
  assert.equal(linesOf(shapes(buildModel("r=3"), 0, v)).length, 1);
});

test("Slider: Animation vorwärts, rückwärts, hin und her, mehrere gleichzeitig", () => {
  const s = { ...createSlider("a"), min: 0, max: 4, value: 0 };
  near(stepSlider(s, 1).value, 1);
  near(stepSlider({ ...s, speed: 2 }, 1).value, 2);
  near(stepSlider({ ...s, value: 3.5 }, 1).value, 0.5); // Umlauf
  const back = { ...s, mode: "backward" as const, dir: -1 as const, value: 0.5 };
  near(stepSlider(back, 1).value, 3.5);
  const pp = { ...s, mode: "pingpong" as const, value: 3.5 };
  const r1 = stepSlider(pp, 1);
  near(r1.value, 3.5);
  assert.equal(r1.dir, -1);
  near(stepSlider(r1, 1).value, 2.5);
  // mehrere Parameter gleichzeitig mit eigener Geschwindigkeit
  const list = [{ ...s, name: "a" }, { ...s, name: "b", speed: 0.5, value: 2 }];
  const next = list.map((x) => stepSlider(x, 1));
  assert.deepEqual(sliderParams(next), { a: 1, b: 2.5 });
  // Konfiguration und Wertsetzen
  near(setSliderValue({ ...s, step: 0.5 }, 1.3).value, 1.5);
  near(setSliderValue(s, 99).value, 4);
  assert.equal(configureSlider(s, { min: 5 }), s);
  assert.equal(configureSlider(s, { step: -1 }), s);
  near(configureSlider({ ...s, value: 3 }, { max: 2 }).value, 2);
});

test("Slider im Modell: a·sin(b·x+c) wird erst mit allen Parametern gezeichnet", () => {
  const src = "a\\sin(bx+c)";
  const m0 = buildModel(src);
  assert.equal(m0.lines[0].kind, "pending");
  assert.deepEqual(m0.missing, ["a", "b", "c"]);
  const m1 = buildModel(src, { a: 2, b: 1, c: 0 });
  near(itemOf(m1, 0).probe!(Math.PI / 2), 2);
  near(itemOf(buildModel(src, { a: 2, b: 1, c: Math.PI / 2 }), 0).probe!(0), 2);
});

test("Leistung: implizit, Ungleichung und Polarkurve bei 1600×900", () => {
  const v: View = { ...defaultView(1600, 900), sx: 50, sy: 50 };
  const m = buildModel("x^2+y^2=25\nx^2+y^2<25\nr=1+2\\cos(\\theta)\n\\sin(x)\\cos(y)=0.3");
  for (let i = 0; i < 4; i++) {
    const t0 = performance.now();
    itemOf(m, i).draw(v);
    const dt = performance.now() - t0;
    console.log(`# Leistung Zeile ${i}: ${dt.toFixed(1)} ms`);
    assert.ok(dt < 400, `Zeile ${i}: ${dt.toFixed(0)} ms`);
  }
});
