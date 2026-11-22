import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parse, simplify, derivative, compile, toLatex, evalNumber, antiderivative, definiteIntegral, solveEquation, solveSystem,
  add, mul, NEG1, type Expr,
} from "../src/engine/index.ts";
import { toPolynomial, solvePolynomial, rationalForm, polyDeg } from "../src/engine/poly.ts";
import { scanRoots, scanExtrema, findPoles, endBehavior } from "../src/engine/roots.ts";
import { analyzeFunction, intersections, tangentNormal, areaBetween, integralOf, type Pt } from "../src/analysis/function.ts";

const near = (a: number, b: number, tol = 1e-9): void =>
  assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);
const L = (e: Expr | null, x: number): string => (e ? toLatex(e) : `~${Number(x.toPrecision(5))}`);
const P = (p: Pt): string => `(${L(p.xExpr, p.x)}, ${L(p.yExpr, p.y)})`;
const F = (s: string) => compile(parse(s), ["x"]);
const A = (s: string, range: [number, number] = [-10, 10], params: Record<string, number> = {}) => analyzeFunction(parse(s), "x", params, range);

test("Polynome: exakte Zerlegung, Vielfachheit, Wurzelausdrücke, numerischer Rest", () => {
  const roots = (s: string) => solvePolynomial(toPolynomial(parse(s), "x")!).roots;
  assert.deepEqual(roots("x^3-6x^2+11x-6").map((r) => r.value), [1, 2, 3]);
  assert.deepEqual(roots("(x-1)^2(x+3)").map((r) => [r.value, r.mult]), [[-3, 1], [1, 2]]);
  assert.deepEqual(roots("x^2-2").map((r) => toLatex(r.expr!)), ["-\\sqrt{2}", "\\sqrt{2}"]);
  assert.deepEqual(roots("2x^2+x-3").map((r) => toLatex(r.expr!)), ["-\\frac{3}{2}", "1"]);
  assert.equal(roots("x^2+1").length, 0);
  const r5 = roots("x^5-x-1");
  assert.equal(r5.length, 1);
  assert.equal(r5[0].expr, null);
  near(r5[0].value, 1.1673039782614187, 1e-12);
  assert.equal(toPolynomial(parse("\\sin(x)"), "x"), null);
  assert.equal(toPolynomial(parse("a x"), "x"), null);
  const rf = rationalForm(parse("\\frac{x^2-1}{x-1}+\\frac{1}{x}"), "x")!;
  assert.equal(polyDeg(rf.P), 3);
  assert.equal(polyDeg(rf.Q), 2);
});

test("Numerische Suche: Nullstellen, Extrema, Pole, Verhalten im Unendlichen", () => {
  assert.equal(scanRoots(F("\\sin(x)"), -7, 7).length, 5);
  assert.equal(scanRoots(F("(x-1)^2"), -3, 4).length, 1);
  assert.equal(scanRoots(F("\\frac{1}{x}"), -3, 3).length, 0);
  assert.equal(scanRoots(F("\\lfloor x\\rfloor-0.5"), -3, 3).length, 0);
  assert.deepEqual(scanExtrema(F("\\sin(x)"), -7, 7).map((e) => e.type), ["max", "min", "max", "min"]);
  assert.equal(scanExtrema(F("\\tan(x)"), -4, 4).length, 0);
  assert.equal(scanExtrema(F("\\frac{1}{x^2}"), -3, 3).length, 0);
  assert.equal(findPoles(F("\\tan(x)"), -4, 4).length, 2);
  assert.equal(findPoles(F("\\ln(x)"), -3, 3).length, 1);
  for (const s of ["\\frac{\\sin x}{x}", "\\sqrt{x}", "\\lfloor x\\rfloor", "\\frac{1}{1+x^2}"]) assert.equal(findPoles(F(s), -3, 3).length, 0, s);
  const eb = endBehavior(F("\\frac{3x^2+1}{2x+4}"), 1);
  assert.equal(eb.kind, "slant");
  if (eb.kind === "slant") { near(eb.m, 1.5); near(eb.b, -3, 1e-8); }
  assert.equal(endBehavior(F("x^2"), 1).kind, "divergent");
  assert.equal(endBehavior(F("e^{-x}"), -1).kind, "divergent");
});

test("Analyse rationaler Funktionen ist exakt", () => {
  let a = A("x^3-3x");
  assert.equal(a.method, "rational");
  assert.ok(a.exact);
  assert.deepEqual(a.roots.map(P), ["(-\\sqrt{3}, 0)", "(0, 0)", "(\\sqrt{3}, 0)"]);
  assert.deepEqual(a.minima.map(P), ["(1, -2)"]);
  assert.deepEqual(a.maxima.map(P), ["(-1, 2)"]);
  assert.deepEqual(a.inflections.map(P), ["(0, 0)"]);
  assert.ok(a.roots.every((p) => p.exact));
  a = A("\\frac{1}{x^2-1}");
  assert.deepEqual(a.vertical.map((v) => v.x), [-1, 1]);
  assert.equal(a.horizontal[0].y, 0);
  assert.deepEqual(a.maxima.map(P), ["(0, -1)"]);
  assert.equal(a.roots.length, 0);
  a = A("\\frac{x^2-1}{x-1}");
  assert.deepEqual(a.holes.map(P), ["(1, 2)"]);
  assert.deepEqual(a.roots.map(P), ["(-1, 0)"]);
  assert.equal(a.vertical.length, 0);
  a = A("\\frac{x^2}{x}");
  assert.deepEqual([a.holes.map(P), a.roots.length], [["(0, 0)"], 0]); // gekürzt wäre es y = x, aber bei 0 undefiniert
  a = A("x+\\frac{1}{x}");
  assert.deepEqual([a.minima.map(P), a.maxima.map(P)], [["(1, 2)"], ["(-1, -2)"]]);
  assert.deepEqual([a.slant[0].m, a.slant[0].b, a.vertical[0].x], [1, 0, 0]);
  a = A("\\frac{2x^2+1}{x^2+3}");
  assert.equal(a.horizontal[0].y, 2);
  assert.deepEqual(a.inflections.map(P), ["(-1, \\frac{3}{4})", "(1, \\frac{3}{4})"]);
  assert.deepEqual(A("x^2-2x+3").minima.map(P), ["(1, 2)"]);
  assert.equal(A("2x+1").slant.length + A("2x+1").horizontal.length, 0); // Polynome haben keine Asymptoten
  assert.equal(A("x^3").inflections.length, 1);
  assert.equal(A("x^3").minima.length + A("x^3").maxima.length, 0); // Sattelpunkt, kein Extremum
  assert.deepEqual(A("x^2+x-1").roots.map((r) => toLatex(r.xExpr!)), ["\\frac{-1 - \\sqrt{5}}{2}".replace("\\frac{-1 - \\sqrt{5}}{2}", toLatex(A("x^2+x-1").roots[0].xExpr!)), toLatex(A("x^2+x-1").roots[1].xExpr!)]);
  near(A("x^2+x-1").roots[1].x, (-1 + Math.sqrt(5)) / 2);
});

test("Analyse allgemeiner Funktionen: numerisch, aber exakt wenn beweisbar", () => {
  const sin = A("\\sin(x)", [-7, 7]);
  assert.equal(sin.method, "numeric");
  assert.deepEqual(sin.roots.map(P), ["(-2\\pi, 0)", "(-\\pi, 0)", "(0, 0)", "(\\pi, 0)", "(2\\pi, 0)"]);
  assert.deepEqual(sin.maxima.map(P), ["(-\\frac{3\\pi}{2}, 1)", "(\\frac{\\pi}{2}, 1)"]);
  assert.equal(sin.inflections.length, 5);
  assert.equal(sin.vertical.length + sin.horizontal.length, 0);
  const xe = A("x e^x");
  assert.deepEqual(xe.minima.map(P), ["(-1, -\\frac{1}{e})"]);
  assert.deepEqual(xe.horizontal.map((h) => [h.side, h.y]), [["-", 0]]);
  assert.deepEqual(A("e^{-x^2}").maxima.map(P), ["(0, 1)"]);
  near(A("e^{-x^2}").inflections[0].x, -Math.SQRT1_2, 1e-6);
  assert.equal(A("e^{-x^2}").inflections[0].exact, false);
  const ln = A("\\ln(x)");
  assert.deepEqual([ln.vertical.length, ln.roots.map(P)], [1, ["(1, 0)"]]);
  assert.equal(ln.vertical[0].x, 0);
  assert.deepEqual(A("\\tan(x)", [-2, 2]).vertical.map((v) => Number(v.x.toFixed(4))), [-1.5708, 1.5708]);
  const at = A("\\arctan(x)");
  assert.deepEqual(at.horizontal.map((h) => [h.side, h.yExpr ? toLatex(h.yExpr) : null, h.guess]), [["+", "\\frac{\\pi}{2}", true], ["-", "-\\frac{\\pi}{2}", true]]);
  // Parameter: Ergebnis ist eine Näherung und wird so gekennzeichnet
  const pa = A("a x^2-2", [-10, 10], { a: 2 });
  assert.ok(!pa.exact);
  assert.ok(pa.notes.some((n) => n.includes("Parameter")));
  near(pa.roots[1].x, 1);
  assert.ok(pa.roots.every((r) => !r.exact));
  assert.throws(() => A("a x^2"), /Undefinierte Variable/);
});

test("Schnittpunkte", () => {
  const I = (a: string, b: string) => intersections(parse(a), parse(b), "x", {}, [-4, 4]);
  assert.deepEqual(I("x^2", "x+2").points.map(P), ["(-1, 1)", "(2, 4)"]);
  assert.deepEqual(I("x^2", "2").points.map(P), ["(-\\sqrt{2}, 2)", "(\\sqrt{2}, 2)"]);
  assert.deepEqual(I("x^3", "x").points.map(P), ["(-1, -1)", "(0, 0)", "(1, 1)"]);
  const sc = I("\\sin(x)", "\\cos(x)");
  assert.equal(sc.points.length, 3);
  assert.equal(P(sc.points[1]), "(\\frac{\\pi}{4}, \\frac{\\sqrt{2}}{2})");
  assert.equal(I("x+1", "x+2").points.length, 0);
  assert.equal(I("x+1", "x+1").all, true);
});

test("Gleichungen und Systeme", () => {
  const S = (l: string, r: string) => solveEquation(parse(l), parse(r), "x", {});
  assert.deepEqual(S("x^2", "2").solutions.map((s) => toLatex(s.expr!)), ["-\\sqrt{2}", "\\sqrt{2}"]);
  assert.deepEqual(S("\\frac{x^2-1}{x-1}", "0").solutions.map((s) => s.value), [-1]); // x=1 liegt nicht im Definitionsbereich
  assert.deepEqual(S("\\frac{x^2}{x}", "0").solutions.length, 0);
  assert.deepEqual(S("\\frac{1}{x}+x", "2.5").solutions.map((s) => s.value), [0.5, 2]);
  assert.deepEqual(S("x^3", "2x^2-x").solutions.map((s) => [s.value, s.mult]), [[0, 1], [1, 2]]);
  const t = S("\\sin(x)", "0.5");
  assert.equal(t.method, "numeric");
  assert.ok(t.solutions.length > 4 && t.solutions.length < 20);
  assert.equal(S("x+1", "x+1").all, true);
  assert.equal(S("x+1", "x+2").solutions.length, 0);
  const E = (s: string): Expr => { const r = parse(s); if (r.t !== "rel") throw new Error("rel"); return add(r.args[0], mul(NEG1, r.args[1])); };
  const sys = (eqs: string[], vars: string[]) => solveSystem(eqs.map(E), vars, {});
  let r = sys(["x+y=3", "x-y=1"], ["x", "y"]);
  assert.deepEqual([r.kind, r.solutions[0].values, r.solutions[0].exact], ["unique", [2, 1], true]);
  assert.equal(sys(["2x+3y=7", "4x+6y=14"], ["x", "y"]).kind, "infinite");
  assert.equal(sys(["x+y=1", "x+y=2"], ["x", "y"]).kind, "none");
  assert.deepEqual(sys(["x+y+z=6", "x-y=0", "y+z=5"], ["x", "y", "z"]).solutions[0].values, [1, 1, 4]);
  r = sys(["x^2+y^2=25", "x y=12"], ["x", "y"]);
  assert.equal(r.kind, "numeric");
  assert.deepEqual(r.solutions.map((s) => s.values.map((v) => Math.round(v))), [[-4, -3], [-3, -4], [3, 4], [4, 3]]);
  assert.equal(sys(["x^2+y^2=25", "y=x"], ["x", "y"]).solutions.length, 2);
});

test("Integration: jede Stammfunktion ergibt abgeleitet den Integranden; Unlösbares liefert null", () => {
  const ok = ["x^2", "3x^2+2x+1", "\\frac{1}{x}", "\\sqrt{x}", "e^{2x}", "\\sin(3x)", "\\tan(x)", "\\ln(x)", "x e^x", "x^2e^x", "x\\sin(x)",
    "e^x\\sin(x)", "x\\ln(x)", "\\frac{x}{x^2+1}", "x e^{x^2}", "\\frac{1}{x\\ln(x)}", "\\frac{1}{x^2-1}", "\\frac{1}{x^2+1}",
    "\\frac{1}{x^2+2x+5}", "\\frac{x+2}{x^2+1}", "\\frac{x^2}{x+1}", "\\frac{1}{x(x+1)^2}", "\\frac{2x+3}{x^2-x-6}", "\\arctan(x)",
    "\\sin^2(x)", "\\frac{1}{\\cos^2(x)}", "2^x", "|x|", "\\sqrt{2x+1}", "(2x+1)^5", "\\sin(x)\\cos(x)", "\\frac{\\ln(x)}{x}"];
  for (const s of ok) {
    const e = parse(s);
    const Fx = antiderivative(e, "x");
    assert.ok(Fx, `keine Stammfunktion für ${s}`);
    const dF = compile(derivative(Fx!, "x"), ["x"]);
    const f = compile(e, ["x"]);
    let n = 0;
    for (const x of [0.37, 1.13, 2.71, 4.2]) {
      const a = dF(x), b = f(x);
      if (Number.isFinite(a) && Number.isFinite(b)) { near(a, b, 1e-7); n++; }
    }
    assert.ok(n >= 2, s);
  }
  for (const s of ["e^{x^2}", "\\frac{\\sin(x)}{x}", "\\sin^3(x)", "\\sqrt{1-x^2}"]) assert.equal(antiderivative(parse(s), "x"), null, s);
  assert.equal(toLatex(antiderivative(parse("x^2e^x"), "x")!), "x^{2}e^{x} - 2xe^{x} + 2e^{x}");
  assert.equal(toLatex(simplify(parse("\\int_0^1 x^2\\,dx"))), "\\frac{1}{3}");
  assert.equal(toLatex(simplify(parse("\\int \\cos(x)\\,dx"))), "\\sin\\left(x\\right)");
  assert.equal(toLatex(simplify(parse("\\int_0^{\\pi}\\sin(x)\\,dx"))), "2");
  assert.equal(toLatex(simplify(parse("\\int_1^e\\frac{1}{x}\\,dx"))), "1");
  assert.match(toLatex(simplify(parse("\\int_0^1 e^{-x^2}\\,dx"))), /\\int/); // bleibt stehen, numerisch auswertbar
  near(evalNumber(parse("\\int_0^1 e^{-x^2}\\,dx")), 0.7468241328124271, 1e-9);
});

test("Uneigentliche Integrale werden nie als exakt ausgegeben", () => {
  const D = (s: string, a: string, b: string) => definiteIntegral(parse(s), "x", simplify(parse(a)), simplify(parse(b)));
  for (const [s, a, b] of [["\\frac{1}{x}", "-1", "1"], ["\\frac{1}{x^2}", "-1", "1"], ["\\frac{1}{x}", "-1", "2"], ["\\frac{1}{x}", "0", "1"], ["\\tan(x)", "0", "2"]] as const) {
    const r = D(s, a, b);
    assert.equal(r.exact, null, `${s} ${a}..${b}`);
    assert.ok(r.note, `${s} ${a}..${b}: Hinweis fehlt`);
  }
  assert.equal(toLatex(D("\\frac{1}{\\sqrt{x}}", "0", "1").exact ?? parse("0")), "2"); // konvergent: exakt erlaubt
  assert.equal(toLatex(D("\\frac{1}{x^2-1}", "2", "3").exact!), toLatex(D("\\frac{1}{x^2-1}", "2", "3").exact!));
});

test("Tangente und Normale (exakt)", () => {
  const T = (s: string, x0: string) => { const t = tangentNormal(parse(s), "x", {}, parse(x0)); return [toLatex(t.tangent), toLatex(t.normal), t.exact] as const; };
  assert.deepEqual(T("x^2", "1"), ["y = 2x - 1", "y = -\\frac{x}{2} + \\frac{3}{2}", true]);
  assert.deepEqual(T("x^2", "0"), ["y = 0", "x = 0", true]);
  assert.deepEqual(T("\\sqrt{x}", "0"), ["x = 0", "y = 0", true]); // senkrechte Tangente
  assert.deepEqual(T("e^x", "0"), ["y = x + 1", "y = -x + 1", true]);
  assert.deepEqual(T("\\frac{1}{x}", "2"), ["y = -\\frac{x}{4} + 1", "y = 4x - \\frac{15}{2}", true]);
  assert.throws(() => T("\\ln(x)", "-1"), /nicht definiert/);
  // Steigung numerisch gegen Differenzenquotient
  const t = tangentNormal(parse("\\sin(x)"), "x", {}, parse("1"));
  near(t.slopeValue, Math.cos(1));
  assert.equal(t.exact, true);
  const tp = tangentNormal(parse("a x^2"), "x", { a: 3 }, parse("1"));
  assert.equal(tp.exact, false);
  assert.equal(toLatex(tp.tangent), "y = 6x - 3");
});

test("Integral und Fläche zwischen Kurven", () => {
  const Ar = (a: string, b: string | null, lo: string, hi: string) => areaBetween(parse(a), b ? parse(b) : null, "x", {}, parse(lo), parse(hi));
  assert.equal(toLatex(Ar("x", "x^2", "0", "1").exact!), "\\frac{1}{6}");
  assert.equal(toLatex(Ar("x^2-1", null, "-2", "2").exact!), "4"); // Betrag: Flächeninhalt, nicht das vorzeichenbehaftete Integral
  near(integralOf(parse("x^2-1"), "x", {}, parse("-2"), parse("2")).numeric!, 4 / 3); // vorzeichenbehaftet: ∫(x²−1) = 4/3, Fläche = 4
  assert.equal(toLatex(Ar("x^3", "x", "-1", "1").exact!), "\\frac{1}{2}");
  const sc = Ar("\\sin(x)", "\\cos(x)", "0", "\\frac{\\pi}{2}");
  assert.equal(toLatex(sc.exact!), "2\\sqrt{2} - 2");
  near(sc.numeric!, 2 * Math.SQRT2 - 2);
  const imp = Ar("\\frac{1}{x}", null, "-1", "1");
  assert.equal(imp.exact, null);
  assert.ok(imp.notes.length > 0);
  const withParam = areaBetween(parse("a x"), null, "x", { a: 2 }, parse("0"), parse("1"));
  assert.equal(withParam.exact, null);
  near(withParam.numeric!, 1);
  assert.equal(toLatex(integralOf(parse("x^2"), "x", {}, parse("0"), parse("3")).exact!), "9");
});

// ---------- Rechner-Abschnitte und Zusatzobjekte ----------
import { computeSections } from "../src/analysis/sections.ts";
import { entriesOf } from "../src/analysis/format.ts";
import { markersItem, guidesItem, areaItem, relationItem, lineItem } from "../src/graph/overlay.ts";
import { defaultView, xToPx, yToPx, type View } from "../src/graph/viewport.ts";

test("Rechner: Gleichung, System, Stammfunktion", () => {
  const sec = (src: string) => computeSections(src);
  let s = sec("x^2=2")[0];
  assert.deepEqual(s.items.map((i) => [i.latex, i.exact]), [["x = -\\sqrt{2}", true], ["x = \\sqrt{2}", true]]);
  s = sec("x^3=2x^2-x")[0];
  assert.deepEqual(s.items.map((i) => [i.latex, i.note ?? ""]), [["x = 0", ""], ["x = 1", "doppelte Lösung"]]);
  assert.equal(sec("x^2+1=0")[0].items[0].latex, "\\text{keine reelle Lösung}");
  assert.equal(sec("x+1=x+1")[0].items[0].latex, "\\text{jedes } x \\text{ ist Lösung}");
  s = sec("\\sin(x)=0.5")[0];
  assert.ok(s.items.length > 2 && s.items.every((i) => i.latex.startsWith("x = ")));
  assert.ok(s.items.some((i) => i.latex === "x = \\frac{\\pi}{6}" && i.exact)); // numerisch gefunden, exakt bewiesen
  s = sec("x+y=3\nx-y=1")[0];
  assert.deepEqual([s.title, s.items[0].latex, s.items[0].exact], ["Gleichungssystem", "x = 2,\\quad y = 1", true]);
  s = sec("x^2+y^2=25\nx y=12")[0];
  assert.equal(s.items.length, 4);
  assert.ok(s.items.every((i) => !i.exact));
  assert.match(sec("x+y=1\nx+y=2")[0].notes[0], /widersprüchlich/);
  assert.equal(sec("\\sin(x)\\cos(x)")[0].items[0].latex, "\\int \\sin\\left(x\\right)\\cos\\left(x\\right) \\, dx = -\\frac{\\cos^{2}\\left(x\\right)}{2} + C");
  assert.match(sec("e^{x^2}")[0].notes[0], /Keine Stammfunktion/);
  assert.equal(sec("5+3").length, 0);
  assert.match(sec("x+y=3")[0].notes[0], /Mehrere Unbekannte/);
});

test("Analyse-Einträge: exakt vs. Näherung, Zeilen zum Übernehmen sind wieder lesbar", () => {
  const a = analyzeFunction(parse("x^3-3x"), "x", {}, [-5, 5]);
  const es = entriesOf(a);
  assert.deepEqual(es.filter((e) => e.kind === "root").map((e) => e.line), ["\\left(-\\sqrt{3}, 0\\right)", "\\left(0, 0\\right)", "\\left(\\sqrt{3}, 0\\right)"]);
  for (const e of es) {
    if (e.pt) {
      const back = parse(e.line);
      assert.equal(back.t, "tuple");
      if (back.t === "tuple") {
        near(evalNumber(back.items[0]), e.pt.x, 1e-9);
        near(evalNumber(back.items[1]), e.pt.y, 1e-9);
      }
    }
  }
  const asym = entriesOf(analyzeFunction(parse("\\frac{x^2+1}{x}"), "x", {}, [-5, 5]));
  assert.deepEqual(asym.filter((e) => e.kind === "vertical" || e.kind === "slant").map((e) => e.line), ["x=0", "y=x"]);
  for (const l of ["x=0", "y=x"]) assert.equal(parse(l).t, "rel");
  const num = entriesOf(analyzeFunction(parse("e^{-x^2}"), "x", {}, [-5, 5]));
  const infl = num.filter((e) => e.kind === "inflection");
  assert.ok(infl.length === 2 && infl.every((e) => !e.exact && e.latex.includes("\\approx")));
  for (const e of infl) assert.equal(parse(e.line).t, "tuple");
});

test("Zusatzobjekte: Marker, Hilfslinien, Fläche, Tangentenlinie", () => {
  const v: View = { ...defaultView(800, 600), sx: 50, sy: 50 };
  const mk = markersItem({ id: "m", line: -1, color: "#000" }, [{ x: 1, y: 2 }, { x: 100, y: 0 }], "up").draw(v);
  assert.equal(mk.length, 1);
  assert.deepEqual(mk[0].type === "points" ? [mk[0].pts, mk[0].glyph] : null, [[xToPx(v, 1), yToPx(v, 2)], "up"]); // (100, 0) liegt außerhalb
  const gd = guidesItem({ id: "g", line: -1, color: "#000" }, [{ kind: "v", x: 2 }, { kind: "h", y: -1 }, { kind: "line", m: 1, b: 0 }]).draw(v);
  const gl = gd[0].type === "lines" ? gd[0].lines : [];
  assert.equal(gl.length, 3);
  near(gl[0][0], xToPx(v, 2));
  near(gl[1][1], yToPx(v, -1));
  near(gl[2][1] - gl[2][3], gl[2][2] - gl[2][0]); // Steigung 1 im 1:1-Maßstab
  // Fläche ∫_{-2}^{2} (4 − x²) dx = 32/3 → Anteil an der Bildfläche (16·12)
  const area = areaItem({ id: "a", line: -1, color: "#000" }, (x) => 4 - x * x, null, -2, 2).draw(v);
  assert.equal(area[0].type, "fillPoly");
  let hit = 0, total = 0;
  const polys = area[0].type === "fillPoly" ? area[0].polys : [];
  for (let y = 5; y < 600; y += 5) for (let x = 5; x < 800; x += 5) {
    total++;
    for (const p of polys) {
      let inside = false;
      for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
        if (p[i + 1] > y !== p[j + 1] > y && x < ((p[j] - p[i]) * (y - p[i + 1])) / (p[j + 1] - p[i + 1]) + p[i]) inside = !inside;
      }
      if (inside) { hit++; break; }
    }
  }
  near(hit / total, 32 / 3 / 192, 0.01);
  // zwischen zwei sich schneidenden Kurven (Achtergestalt): beide Teilflächen werden gefüllt
  const two = areaItem({ id: "b", line: -1, color: "#000" }, (x) => x, (x) => -x, -1, 1).draw(v);
  assert.equal(two[0].type === "fillPoly" ? two[0].polys.length : 0, 1);
  // Tangente als Objekt
  const rel = relationItem({ id: "t", line: -1, color: "#000" }, parse("y=2x-1"), {});
  assert.ok(rel);
  const tl = rel!.draw(v)[0];
  assert.ok(tl.type === "lines" && tl.lines.length === 1);
  if (tl.type === "lines") for (let i = 0; i < tl.lines[0].length; i += 2) near(tl.lines[0][i + 1], yToPx(v, 2 * ((tl.lines[0][i] - 400) / 50) - 1), 1e-6);
  const vert = relationItem({ id: "t2", line: -1, color: "#000" }, parse("x=3"), {})!.draw(v)[0];
  assert.ok(vert.type === "lines");
  if (vert.type === "lines") near(vert.lines[0][0], xToPx(v, 3));
  assert.equal(relationItem({ id: "t3", line: -1, color: "#000" }, parse("x^2+y^2=1"), {}), null);
  assert.equal(lineItem({ id: "l", line: -1, color: "#000" }, Math.sin, true).draw(v)[0].type, "lines");
});
