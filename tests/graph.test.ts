import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultView, xToPx, yToPx, xFromPx, yFromPx, zoomAt, pan, ranges, viewFromRanges, setScale,
  linearTicks, logTicks, formatTick, formatCoord, type View,
} from "../src/graph/viewport.ts";
import { samplePolylines } from "../src/graph/sampler.ts";
import { buildModel } from "../src/graph/model.ts";

const near = (a: number, b: number, tol = 1e-9): void =>
  assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);

const W = 800;
const H = 600;
const baseView = (): View => ({ ...defaultView(W, H), sx: 50, sy: 50 }); // x ∈ [-8, 8], y ∈ [-6, 6]

const sample = (f: (x: number) => number, v: View = baseView(), extra = {}) =>
  samplePolylines(f, { xFromPx: (p) => xFromPx(v, p), yToPx: (y) => yToPx(v, y), width: v.width, height: v.height, ...extra });

test("Viewport: Umrechnung Welt <-> Pixel (linear und logarithmisch)", () => {
  const v = baseView();
  for (const x of [-7.5, 0, 3.25]) near(xFromPx(v, xToPx(v, x)), x);
  for (const y of [-5, 0.5, 5.9]) near(yFromPx(v, yToPx(v, y)), y);
  near(xToPx(v, 0), W / 2);
  near(yToPx(v, 0), H / 2);
  const lv = viewFromRanges({ xMin: 0.1, xMax: 1000, yMin: 1, yMax: 1e6 }, W, H, "log", "log") as View;
  assert.ok(lv);
  for (const x of [0.1, 1, 77, 1000]) near(xFromPx(lv, xToPx(lv, x)), x, 1e-9);
  near(xToPx(lv, 0.1), 0, 1e-9);
  near(yToPx(lv, 1), H, 1e-9);
  assert.ok(Number.isNaN(xToPx(lv, -1)));
  assert.equal(viewFromRanges({ xMin: -1, xMax: 10, yMin: 1, yMax: 2 }, W, H, "log", "linear"), null);
});

test("Viewport: Zoom um den Cursor hält den Weltpunkt fest; Pan verschiebt", () => {
  let v = baseView();
  const px = 123, py = 456;
  const wx = xFromPx(v, px), wy = yFromPx(v, py);
  v = zoomAt(v, px, py, 2, 2);
  near(xFromPx(v, px), wx);
  near(yFromPx(v, py), wy);
  near(v.sx, 100);
  v = zoomAt(v, px, py, 0.25, 1);
  near(xFromPx(v, px), wx);
  near(v.sy, 100);
  const p = pan(baseView(), 50, -25);
  near(ranges(p).xMin, -9);
  near(ranges(p).yMin, -6 + -0.5);
  const lv = setScale(baseView(), "x", "log");
  assert.equal(lv.xScale, "log");
  assert.ok(ranges(lv).xMin > 0);
});

test("Raster: Schrittweiten, Nebenlinien, Beschriftung", () => {
  const t = linearTicks(-8, 8, 50);
  assert.equal(t.step, 2);
  assert.ok(t.major.includes(0) && t.major.includes(2) && !t.major.includes(1));
  assert.ok(t.minor.includes(0.5) && !t.minor.includes(2));
  assert.deepEqual(linearTicks(0, 1, 800).major.slice(0, 3), [0, 0.1, 0.2]);
  assert.deepEqual(linearTicks(-1, 1, 50, 0.5).major, [-1, -0.5, 0, 0.5, 1]);
  assert.deepEqual(logTicks(0.5, 2000, 150).major, [1, 10, 100, 1000]);
  assert.ok(logTicks(0.5, 2000, 150).minor.includes(200));
  assert.equal(formatTick(0.2, 0.2), "0.2");
  assert.equal(formatTick(-0.0, 0.5), "0");
  assert.equal(formatTick(1e7, 1e6), "1e+7");
  assert.equal(formatTick(100, 10, "log"), "100");
  assert.equal(formatTick(1e6, 10, "log"), "10⁶");
  assert.equal(formatCoord(0.1 + 0.2), "0.3");
  assert.equal(formatCoord(NaN), "undefiniert");
});

test("Sampler: glatte Funktion ergibt eine Polylinie, Punkte liegen auf der Kurve", () => {
  const v = baseView();
  const lines = sample(Math.sin, v);
  assert.equal(lines.length, 1);
  const pts = lines[0];
  assert.ok(pts.length / 2 > W / 2 && pts.length / 2 < 4000, `Punkte: ${pts.length / 2}`);
  for (let i = 0; i < pts.length; i += 2) near(pts[i + 1], yToPx(v, Math.sin(xFromPx(v, pts[i]))), 1e-9);
});

test("Sampler: Polstelle 1/x trennt die Äste", () => {
  const v = baseView();
  const lines = sample((x) => 1 / x, v);
  assert.equal(lines.length, 2);
  const p0 = xToPx(v, 0);
  assert.ok(lines[0].every((_, i) => i % 2 === 1 || lines[0][i] < p0));
  assert.ok(lines[1].every((_, i) => i % 2 === 1 || lines[1][i] > p0));
});

test("Sampler: tan(x) hat in [-2π, 2π] genau 4 Pole -> 5 Äste", () => {
  const v = viewFromRanges({ xMin: -2 * Math.PI, xMax: 2 * Math.PI, yMin: -6, yMax: 6 }, W, H, "linear", "linear") as View;
  const lines = sample(Math.tan, v);
  assert.equal(lines.length, 5);
});

test("Sampler: Sprungstellen von floor(x) werden nicht verbunden", () => {
  const v = viewFromRanges({ xMin: -3.5, xMax: 3.5, yMin: -5, yMax: 5 }, W, H, "linear", "linear") as View;
  const lines = sample(Math.floor, v);
  assert.equal(lines.length, 8);
  for (const l of lines) {
    const qs = l.filter((_, i) => i % 2 === 1);
    assert.ok(Math.max(...qs) - Math.min(...qs) < 1e-6, "Stufe muss waagerecht sein");
  }
});

test("Sampler: Definitionsrand sqrt(x) beginnt bei x=0", () => {
  const v = baseView();
  const lines = sample(Math.sqrt, v);
  assert.equal(lines.length, 1);
  const p0 = xToPx(v, 0);
  assert.ok(lines[0][0] >= p0 - 0.01 && lines[0][0] <= p0 + 0.05, `Start bei ${lines[0][0]} statt ${p0}`);
});

test("Sampler: logarithmische y-Achse lässt Werte ≤ 0 aus; Budget wird eingehalten", () => {
  const lv = viewFromRanges({ xMin: -5, xMax: 5, yMin: 0.01, yMax: 100 }, W, H, "linear", "log") as View;
  const lines = sample((x) => x, lv);
  assert.equal(lines.length, 1);
  assert.ok(lines[0][0] > xToPx(lv, 0));
  let evals = 0;
  const lines2 = sample((x) => (evals++, Math.sin(1 / x)), baseView(), { budget: 5000 });
  assert.ok(evals < 5200, `Auswertungen: ${evals}`);
  assert.ok(lines2.length >= 1);
});

test("Modell: Funktionen, Definitionen, Parameter, Fehler", () => {
  const m = buildModel("f(x)=x^2\na=3\na x\n\\frac{d}{dx} f(x)\nf(2)+1\ny=\\sin(x)\nx^2+y^2=1\nb x\n\\frac{1}{\n\n(1,2)");
  const kinds = m.lines.map((l) => l.kind);
  assert.deepEqual(kinds, ["function", "parameter", "function", "function", "function", "function", "unsupported", "error", "error", "empty", "unsupported"]);
  assert.equal(m.params.a, 3);
  assert.equal(m.fns.length, 5);
  const g = (i: number) => m.fns.find((f) => f.line === i)!.f;
  near(g(0)(3), 9);
  near(g(2)(2), 6);
  near(g(3)(3), 6); // Ableitung von f
  near(g(4)(0), 5); // konstante Funktion f(2)+1
  near(g(5)(Math.PI / 2), 1);
  assert.match(m.lines[7].message ?? "", /„b“/);
  assert.equal(m.lines[8].pos !== undefined, true);
  assert.ok(m.lines[0].latex?.includes("f"));
});

test("Modell: rekursive Definition wird als Fehler gemeldet, nicht als Absturz", () => {
  const m = buildModel("f(x)=f(x)+1");
  assert.equal(m.lines[0].kind, "error");
  assert.equal(m.fns.length, 0);
});

// ---------- Zeichnen (Mock-Kontext) und Leistung ----------
import { drawBackground, drawCurves, LIGHT } from "../src/graph/draw.ts";
import { compile, parse } from "../src/engine/index.ts";

function mockCtx() {
  const texts: string[] = [];
  const calls: Record<string, number> = {};
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get(t, p: string) {
      if (p === "fillText" || p === "strokeText") return (s: string) => { if (p === "fillText") texts.push(s); };
      if (p in t) return t[p];
      return (..._a: unknown[]) => { calls[p] = (calls[p] ?? 0) + 1; };
    },
    set(t, p: string, v) { t[p] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, texts, calls };
}

test("Zeichnen: Raster, Achsenbeschriftung und Kurven (lineare und log. Achsen)", () => {
  const v = baseView();
  const m = mockCtx();
  drawBackground(m.ctx, v, LIGHT, { show: true, stepX: null, stepY: null });
  assert.ok(m.texts.includes("2") && m.texts.includes("-4") && !m.texts.includes("0"), m.texts.join(","));
  assert.ok((m.calls.lineTo ?? 0) > 20);
  drawCurves(m.ctx, v, [{ color: "#f00", lines: sample(Math.sin, v) }]);
  assert.ok((m.calls.stroke ?? 0) >= 3);

  const lv = viewFromRanges({ xMin: 0.1, xMax: 1e7, yMin: 1, yMax: 1e4 }, W, H, "log", "log") as View;
  const m2 = mockCtx();
  drawBackground(m2.ctx, lv, LIGHT, { show: true, stepX: null, stepY: null });
  assert.ok(m2.texts.includes("1") && m2.texts.includes("10") && m2.texts.some((t) => t.startsWith("10") && t.length > 2), m2.texts.join(","));
  const m3 = mockCtx();
  drawBackground(m3.ctx, v, LIGHT, { show: false, stepX: 1, stepY: null });
  assert.ok(m3.texts.includes("1") && m3.texts.includes("7"));
});

test("Leistung: 6 Funktionen bei 1600×900 in unter 150 ms", () => {
  const v: View = { ...defaultView(1600, 900), sx: 50, sy: 50 };
  const srcs = ["\\sin(x)", "\\frac{1}{x}", "\\tan(x)", "\\lfloor x \\rfloor", "\\frac{x^2}{2}-3", "\\sin(1/x)"];
  const fs = srcs.map((s) => compile(parse(s), ["x"]));
  const t0 = performance.now();
  for (const f of fs) samplePolylines((x) => f(x), { xFromPx: (p) => xFromPx(v, p), yToPx: (y) => yToPx(v, y), width: v.width, height: v.height });
  const dt = performance.now() - t0;
  assert.ok(dt < 150, `${dt.toFixed(1)} ms`);
  console.log(`# Leistung: ${dt.toFixed(1)} ms für 6 Funktionen`);
});
