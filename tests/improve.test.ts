import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parse, ParseError, simplify, compile, toLatex, evalNumber, add, mul, pow, fn, num, sym, NEG1, type Expr,
} from "../src/engine/index.ts";
import { toPolynomial, solvePolynomial, polyEvalNum } from "../src/engine/poly.ts";
import { solveSystem } from "../src/engine/solve.ts";
import { buildModel } from "../src/graph/model.ts";
import { intersectCurves } from "../src/analysis/function.ts";
import { computeSections } from "../src/analysis/sections.ts";
import { defaultView } from "../src/graph/viewport.ts";

const near = (a: number, b: number, tol = 1e-9): void =>
  assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);
const S = (src: string): string => toLatex(simplify(parse(src)));
const E = (s: string): Expr => { const r = parse(s); if (r.t !== "rel") throw new Error("rel"); return add(r.args[0], mul(NEG1, r.args[1])); };

test("Grenzwerte: exakt per Einsetzen, L'Hôpital, Grad, Pole – oder bewusst nur Näherung", () => {
  const exact: [string, string][] = [
    ["\\lim_{x\\to 0}\\frac{\\sin x}{x}", "1"],
    ["\\lim_{x\\to 0}\\frac{1-\\cos x}{x^2}", "\\frac{1}{2}"],
    ["\\lim_{x\\to 0}\\frac{e^x-1}{x}", "1"],
    ["\\lim_{x\\to 1}\\frac{x^2-1}{x-1}", "2"],
    ["\\lim_{x\\to 0}\\frac{\\tan x - x}{x^3}", "\\frac{1}{3}"],
    ["\\lim_{x\\to 0}\\frac{\\sin(3x)}{\\sin(5x)}", "\\frac{3}{5}"],
    ["\\lim_{x\\to 0}\\frac{\\sqrt{1+x}-1}{x}", "\\frac{1}{2}"],
    ["\\lim_{x\\to 2}(x^2+1)", "5"],
    ["\\lim_{x\\to\\infty}\\frac{\\ln x}{x}", "0"],
    ["\\lim_{x\\to\\infty}\\frac{3x^2+1}{2x^2-5}", "\\frac{3}{2}"],
    ["\\lim_{x\\to\\infty}\\frac{x^3}{x+1}", "\\infty"],
    ["\\lim_{x\\to-\\infty}\\frac{x^3}{x+1}", "\\infty"],
    ["\\lim_{x\\to-\\infty}\\frac{x^3}{x^2+1}", "-\\infty"],
    ["\\lim_{x\\to\\infty} x e^{-x}", "0"],
    ["\\lim_{x\\to 0^+} x\\ln x", "0"],
    ["\\lim_{x\\to 0^+} x^x", "1"],
    ["\\lim_{x\\to\\infty}\\left(1+\\frac{1}{x}\\right)^x", "e"],
    ["\\lim_{x\\to 0^+}\\frac{1}{x}", "\\infty"],
    ["\\lim_{x\\to 0^-}\\frac{1}{x}", "-\\infty"],
    ["\\lim_{x\\to 0}\\frac{1}{x^2}", "\\infty"],
    ["\\lim_{x\\to\\infty}\\frac{\\sqrt{x}}{x+1}", "0"],
  ];
  for (const [src, want] of exact) assert.equal(S(src), want, src);
  // existiert nicht oder nicht beweisbar: bleibt ein Grenzwert (numerisch auswertbar), nie ein falscher exakter Wert
  for (const src of ["\\lim_{x\\to 0}\\frac{1}{x}", "\\lim_{x\\to\\infty}\\sin(x)", "\\lim_{x\\to 0}\\lfloor x\\rfloor", "\\lim_{x\\to 0}\\frac{|x|}{x}"]) {
    assert.equal(simplify(parse(src)).t, "lim", src);
    assert.ok(Number.isNaN(evalNumber(parse(src))), src);
  }
  assert.equal(evalNumber(parse("\\lim_{x\\to 0^+}\\frac{1}{x}")), Infinity);
  assert.equal(evalNumber(parse("\\lim_{x\\to 0^-}\\frac{1}{x}")), -Infinity);
  near(evalNumber(parse("\\lim_{x\\to 0^+}\\frac{|x|}{x}")), 1, 1e-6);
});

test("Nullstellen: kubisch (Cardano/trigonometrisch), x^n = c, Polynome in x² – exakt", () => {
  const rootsOf = (s: string) => solvePolynomial(toPolynomial(parse(s), "x")!).roots;
  const resid = (s: string, vals: number[]): number => {
    const c = toPolynomial(parse(s), "x")!.map((k) => Number(k.n) / Number(k.d));
    return Math.max(0, ...vals.map((v) => Math.abs(polyEvalNum(c, v))));
  };
  const cases: [string, number, number][] = [
    ["x^3-2", 1, 1], ["x^3+x+1", 1, 1], ["2x^3-x-5", 1, 1], ["x^3-3x+1", 3, 3], ["x^3-x^2-2x+3", 1, 1],
    ["x^4-5x^2+1", 4, 4], ["x^4-x^2-1", 2, 2], ["x^4-2", 2, 2], ["x^5-2", 1, 1], ["x^4+1", 0, 0], ["x^3-6x-4", 3, 3],
  ];
  for (const [s, count, exactCount] of cases) {
    const r = rootsOf(s);
    assert.equal(r.length, count, s);
    assert.equal(r.filter((x) => x.expr).length, exactCount, `${s}: exakt`);
    assert.ok(resid(s, r.map((x) => x.value)) < 1e-9, `${s}: Residuum`);
    for (const x of r) if (x.expr) near(evalNumber(x.expr), x.value, 1e-12);
  }
  assert.equal(rootsOf("x^5-x-1").every((x) => x.expr === null), true); // Grad 5 allgemein: nur numerisch
  assert.equal(toLatex(rootsOf("x^3-2")[0].expr!), "\\sqrt[3]{2}");
  assert.deepEqual(rootsOf("x^4-16").map((r) => r.value), [-2, 2]);
});

test("Systeme: exakte Elimination (Kreis∩Gerade, Kreis∩Kreis, Parabel∩Gerade, Widerspruch)", () => {
  const sys = (eqs: string[]) => solveSystem(eqs.map(E), ["x", "y"], {});
  const show = (r: ReturnType<typeof sys>) => r.solutions.map((s) => `(${s.exprs.map((e, i) => (e ? toLatex(e) : s.values[i].toFixed(3))).join(", ")})`);
  let r = sys(["x^2+y^2=25", "y=x"]);
  assert.equal(r.kind, "solved");
  assert.ok(r.solutions.length === 2 && r.solutions.every((s) => s.exact));
  near(r.solutions[1].values[0], 5 / Math.SQRT2);
  r = sys(["x^2+y^2=4", "x^2+y^2-4x=0"]);
  assert.deepEqual(show(r), ["(1, -\\sqrt{3})", "(1, \\sqrt{3})"]);
  assert.deepEqual(show(sys(["y=x^2", "y=2x+3"])), ["(-1, 1)", "(3, 9)"]);
  assert.equal(sys(["x^2+y^2=1", "x^2+y^2=4"]).kind, "none");
  assert.equal(sys(["x^2+y^2=1", "x+y=5"]).solutions.length, 0);
  r = sys(["x^2+y^2=25", "x y=12"]);
  assert.deepEqual([r.kind, r.solutions.length, r.solutions.every((s) => !s.exact)], ["numeric", 4, true]);
  r = sys(["y=\\sin(x)", "y=x/2"]);
  assert.equal(r.solutions.length, 3);
  assert.ok(r.solutions.some((s) => s.exact && s.values[0] === 0)); // (0, 0) wird exakt bewiesen
  // eigene Suchbereiche je Variable
  const r2 = solveSystem(["x^2+y^2=25", "x y=12"].map(E), ["x", "y"], {}, [[0, 10], [0, 10]]);
  assert.deepEqual(r2.solutions.map((s) => s.values.map(Math.round)), [[3, 4], [4, 3]]);
});

test("simplify: Zahl·(Summe) in Summen wird ausmultipliziert, gleiche Terme heben sich auf", () => {
  assert.equal(S("x-(x+1)"), "-1");
  assert.equal(S("(x+1)-(x+1)"), "0");
  assert.equal(S("2(x+1)-2x-2"), "0");
  assert.equal(S("x^2+y^2-(x^2+y^2-4x)-4"), "4x - 4");
  assert.equal(S("3(x+1)-2(x+1)"), "x + 1");
  assert.equal(S("-(a+b)"), "-\\left(a + b\\right)"); // allein bleibt es faktorisiert
  assert.equal(S("c-(a+b)"), "-a - b + c");
  assert.equal(S("2(x+1)"), "2\\left(x + 1\\right)"); // allein bleibt es faktorisiert
});

test("Ausgabe nicht vereinfachter Ausdrücke: Vorzeichen und Klammern stimmen", () => {
  const same = (src: string): void => {
    const a = parse(src);
    const b = parse(toLatex(a));
    const [fa, fb] = [compile(a, ["x", "y", "z"]), compile(b, ["x", "y", "z"])];
    for (const p of [[0.3, 1.7, -2.2], [2.1, -0.4, 0.9], [-1.5, 3.3, 1.1]]) near(fb(...p), fa(...p), 1e-12);
  };
  for (const s of ["x-(y+z)", "x-(-x)", "-(x+1)", "-(-x)", "5-(3-1)", "1-(-1)", "x-(y-z)", "-\\frac{1}{2}-(-\\frac{3}{4})", "x-(-(y+z))", "3(-x)",
    "-(-(-x))", "x-(y+z)z", "-(x+1)^2", "2-3-4", "x-2(y-z)", "-x(y+z)", "-(x)(y)", "(x+1)(y-1)-(x-1)(y+1)", "x-\\frac{y-z}{2}", "\\frac{-x}{-y}"]) same(s);
  assert.equal(toLatex(parse("x-(y+z)")), "x - \\left(y + z\\right)");
  assert.equal(toLatex(parse("-(a+b)")), "-\\left(a + b\\right)");
});

test("Zufallstest (fest gesät): Ausgabe → Einlesen und Vereinfachen erhalten den Wert", () => {
  let seed = 99;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
  const gen = (d: number): Expr => {
    if (d <= 0 || rnd() < 0.15) return pick<Expr>([sym("x"), sym("x"), num(2), num(3), num(-1), num(1, 2), num(5)]);
    switch (Math.floor(rnd() * 8)) {
      case 0: return add(gen(d - 1), gen(d - 1));
      case 1: return mul(gen(d - 1), gen(d - 1));
      case 2: return pow(gen(d - 1), pick<Expr>([num(2), num(3), num(-1), num(-2)]));
      case 3: return fn(pick(["sin", "cos", "arctan"]), gen(d - 1));
      case 4: return pow(sym("e"), gen(d - 1));
      case 5: return mul(num(pick([2, 3, -1, 5])), gen(d - 1));
      case 6: return add(gen(d - 1), mul(num(-1), gen(d - 1)));
      default: return fn(pick(["sinh", "cosh", "abs"]), gen(d - 1));
    }
  };
  const same = (a: number, b: number) => (!Number.isFinite(a) && !Number.isFinite(b)) || Math.abs(a - b) <= 1e-8 * (1 + Math.abs(a) + Math.abs(b));
  let bad = 0;
  const msgs: string[] = [];
  for (let i = 0; i < 400; i++) {
    const e = gen(3);
    const f0 = compile(e, ["x"]);
    for (const [name, g] of [["print", () => parse(toLatex(e))], ["simplify", () => simplify(e)], ["simpPrint", () => parse(toLatex(simplify(e)))]] as [string, () => Expr][]) {
      const f1 = compile(g(), ["x"]);
      for (const x of [0.3, 0.71, 1.3, -0.9]) {
        const a = f0(x), b = f1(x);
        if (Number.isNaN(a) && Number.isFinite(b)) continue; // Bereichserweiterung beim Kürzen, z. B. (√x)² → x
        if (!same(a, b)) { bad++; msgs.push(`${name}: ${toLatex(e)} x=${x}: ${a} vs ${b}`); break; }
      }
    }
  }
  assert.equal(bad, 0, msgs.slice(0, 3).join("\n"));
});

test("Ableitungsstriche f'(x), f''(x)", () => {
  const e = parse("f'(x)", { functions: ["f"] });
  assert.deepEqual(e.t === "fn" ? e.name : null, "f'");
  assert.equal(toLatex(e), "f'\\left(x\\right)");
  assert.equal((parse("f''(x)", { functions: ["f"] }) as { name: string }).name, "f''");
  assert.throws(() => parse("f'(x)"), ParseError); // f ist keine definierte Funktion
  assert.throws(() => parse("f'", { functions: ["f"] }), ParseError);
  const m = buildModel("f(x)=x^3\nf'(x)\nf''(2)\ng(x)=f'(x)+1\nh(x)=\\sin(x)\nh''(0)\nk'(x)");
  assert.deepEqual(m.lines.map((l) => l.kind), ["function", "function", "function", "function", "function", "function", "error"]);
  const probe = (i: number) => m.items.find((it) => it.line === i)!.probe!;
  near(probe(1)(2), 12);
  near(probe(2)(0), 12);
  near(probe(3)(1), 4);
  near(probe(5)(1), 0, 1e-12);
  assert.match(m.lines[6].message ?? "", /Unbekannte Funktion|k'/);
  assert.equal(m.lines[1].latex, "f'\\left(x\\right)");
  // Analyse von f' funktioniert über die Definition
  const a = m.items.find((it) => it.line === 3)!.analysis!;
  near(compile(a.expr, ["x"])(2), 13);
});

test("Implizite Kurven mit gerader Vielfachheit sind sichtbar; Schnittpunkte explizit/implizit", () => {
  const v = { ...defaultView(800, 600), sx: 50, sy: 50 };
  for (const [src, check] of [
    ["(x-y)^2=0", (px: number, py: number) => Math.abs((px - 400) + (py - 300)) < 1.5], // Gerade y = x (Pixel: py wächst nach unten)
    ["x^2=0", (px: number) => Math.abs(px - 400) < 1.5],
    ["(x^2-1)^2=0", (px: number) => Math.abs(Math.abs(px - 400) - 50) < 1.5],
  ] as [string, (px: number, py: number) => boolean][]) {
    const m = buildModel(src);
    const sh = m.items[0].draw(v);
    const lines = sh.flatMap((s) => (s.type === "lines" ? s.lines : []));
    assert.ok(lines.length >= 1, src);
    for (const l of lines) for (let i = 0; i < l.length; i += 2) assert.ok(check(l[i], l[i + 1]), `${src}: Punkt ${l[i]},${l[i + 1]}`);
  }
  const m = buildModel("f(x)=x\nx^2+y^2=4\ny=x^2\nx y=1");
  const c = (i: number) => m.items.find((it) => it.line === i)!.curve!;
  let r = intersectCurves(c(0).F, c(1).F, {}, [-5, 5], [-5, 5]);
  assert.deepEqual(r.points.map((p) => [toLatex(p.xExpr!), toLatex(p.yExpr!)]), [["-\\sqrt{2}", "-\\sqrt{2}"], ["\\sqrt{2}", "\\sqrt{2}"]]);
  assert.ok(r.exact);
  r = intersectCurves(c(2).F, c(0).F, {}, [-5, 5], [-5, 5]);
  assert.deepEqual(r.points.map((p) => [p.x, p.y]), [[0, 0], [1, 1]]);
  r = intersectCurves(c(1).F, c(3).F, {}, [-5, 5], [-5, 5]);
  // x y = 1 und x²+y²=4: x⁴ − 4x² + 1 = 0 → vier Schnittpunkte (Elimination nicht möglich: numerisch)
  assert.equal(r.points.length, 4);
  assert.ok(r.points.every((p) => !p.exact && Math.abs(p.x * p.y - 1) < 1e-9 && Math.abs(p.x * p.x + p.y * p.y - 4) < 1e-9));
});

test("Rechner: einstellbarer Suchbereich", () => {
  assert.deepEqual(computeSections("\\sin(x)=0", [-4, 4])[0].items.map((i) => i.latex), ["x = -\\pi", "x = 0", "x = \\pi"]);
  assert.ok(computeSections("\\sin(x)=0", [-20, 20])[0].items.length > 10);
  const s = computeSections("x^3=2")[0];
  assert.deepEqual(s.items.map((i) => [i.latex, i.exact]), [["x = \\sqrt[3]{2}", true]]);
});
