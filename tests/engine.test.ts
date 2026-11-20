import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parse, ParseError, simplify, expand, derivative, compile, evalNumber, toLatex, freeSymbols,
  UndefinedSymbolError, integrate, type Expr,
} from "../src/engine/index.ts";

const S = (src: string): string => toLatex(simplify(parse(src)));
const N = (src: string, params: Record<string, number> = {}): number => evalNumber(parse(src), params);
const near = (a: number, b: number, tol = 1e-9): void =>
  assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);

test("Grundrechenarten und Präzedenz", () => {
  near(N("1-2-3"), -4);
  near(N("2\\cdot3+4"), 10);
  near(N("2(3+4)"), 14);
  near(N("-x^2", { x: 3 }), -9);
  near(N("2x^2", { x: 3 }), 18);
  near(N("\\frac{1}{2}x", { x: 5 }), 2.5);
  near(N("\\frac12"), 0.5);
  near(N("x^23", { x: 2 }), 12); // LaTeX: x^2 · 3
  near(N("xy", { x: 2, y: 3 }), 6);
  near(N("10\\div 4"), 2.5);
});

test("Funktionen, Klammerlose Argumente, Umkehrfunktionen", () => {
  near(N("\\sin x\\cos x", { x: 1 }), Math.sin(1) * Math.cos(1));
  near(N("\\sin 2x", { x: 1 }), Math.sin(2));
  near(N("\\sin^2 x", { x: 1 }), Math.sin(1) ** 2);
  near(N("\\sin^{-1}(\\frac12)"), Math.PI / 6);
  near(N("\\log_2 8"), 3);
  near(N("\\log 100"), 2);
  near(N("\\ln e"), 1);
  near(N("\\sec(0)"), 1);
  near(N("5!"), 120);
  near(N("|x-3|", { x: 1 }), 2);
  near(N("\\left|x-3\\right|", { x: 8 }), 5);
  near(N("\\max(2,7)+\\min(2,7)"), 9);
  near(N("\\exp(2)"), Math.exp(2));
  near(N("\\sqrt[3]{-27}"), -3);
  near(N("x^{1/3}", { x: -8 }), -2);
  near(N("\\lfloor 2.7 \\rfloor + \\lceil 2.1 \\rceil"), 5);
});

test("Exakte Arithmetik und Vereinfachung", () => {
  assert.equal(S("\\frac{1}{2}+\\frac{1}{3}"), "\\frac{5}{6}");
  assert.equal(S("0.1+0.2"), "\\frac{3}{10}");
  assert.equal(S("\\sqrt{16}"), "4");
  assert.equal(S("\\sqrt{8}"), "2\\sqrt{2}");
  assert.equal(S("8^{\\frac13}"), "2");
  assert.equal(S("x-x"), "0");
  assert.equal(S("20!"), "2432902008176640000");
  assert.equal(S("\\sum_{k=1}^{10} k^2"), "385");
  assert.equal(S("\\prod_{k=1}^{5} k"), "120");
  assert.equal(S("\\sin(\\frac{\\pi}{6})"), "\\frac{1}{2}");
  assert.equal(S("\\cos(\\pi)"), "-1");
  assert.equal(S("\\sin(\\frac{\\pi}{4})"), "\\frac{\\sqrt{2}}{2}");
  assert.equal(S("\\tan(\\frac{\\pi}{4})"), "1");
  assert.equal(S("\\ln(e^3)"), "3");
  assert.equal(toLatex(expand(parse("(x+1)^2"))), "x^{2} + 2x + 1");
  assert.equal(toLatex(expand(parse("(x+1)(x-1)"))), "x^{2} - 1");
});

test("Symbolische Ableitung (exakt, als LaTeX)", () => {
  assert.equal(S("\\frac{d}{dx}\\sin(x)"), "\\cos\\left(x\\right)");
  assert.equal(S("\\frac{d}{dx}(x^3+2x)"), "3x^{2} + 2");
  assert.equal(S("\\frac{d^2}{dx^2} x^4"), "12x^{2}");
  assert.equal(S("\\frac{d}{dx} e^{2x}"), "2e^{2x}");
  assert.equal(S("\\frac{d}{dx} \\ln(x)"), "\\frac{1}{x}");
});

test("Ableitungen stimmen mit numerischer Differenz überein", () => {
  const cases = [
    "\\sin(x^2)", "\\ln(x)e^{x}", "\\arctan(x)", "\\frac{x}{x^2+1}", "\\sqrt{x}",
    "\\tan(x)", "\\sinh(x)\\cosh(x)", "\\arcsin(\\frac{x}{3})", "x^x", "|x-1|", "2^x",
    "\\frac{\\sin x}{x}", "(x^2+1)^{3}", "\\int_0^x t^2\\,dt",
  ];
  for (const src of cases) {
    const f = parse(src);
    const df = compile(derivative(f, "x"), ["x"]);
    const g = compile(f, ["x"]);
    for (const x of [0.7, 1.9, 2.4]) {
      const h = 1e-5;
      const fd = (g(x + h) - g(x - h)) / (2 * h);
      near(df(x), fd, 1e-5);
    }
  }
});

test("Integrale", () => {
  near(N("\\int_0^1 x^2\\,dx"), 1 / 3);
  near(N("\\int_0^{\\pi}\\sin(x)\\,dx"), 2);
  near(N("\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx"), Math.sqrt(Math.PI), 1e-8);
  near(N("\\int_0^1 \\frac{1}{\\sqrt{x}}\\,dx"), 2, 1e-6);
  near(N("\\int_1^3 \\int_0^2 xy\\,dx\\,dy"), 8);
  near(N("\\int_0^1 x\\,dx + 1"), 1.5);
  near(integrate((x) => x * x, 3, 0).value, -9);
});

test("Summen, Produkte, Grenzwerte", () => {
  near(N("\\sum_{k=1}^{n} k", { n: 10 }), 55);
  near(N("\\sum_{k=1}^{\\infty} \\frac{1}{2^k}".replace("\\infty", "60")), 1, 1e-12);
  near(N("\\lim_{x\\to 0}\\frac{\\sin x}{x}"), 1, 1e-6);
  near(N("\\lim_{x\\to\\infty}\\frac{1}{x}"), 0, 1e-6);
  near(N("\\lim_{x\\to 0^+} \\frac{1}{x}".replace("\\frac{1}{x}", "x")), 0, 1e-6);
  assert.equal(N("\\lim_{x\\to\\infty} x^2"), Infinity);
});

test("Stückweise Funktionen und Relationen", () => {
  const f = parse("\\begin{cases} x^2 & x \\geq 0 \\\\ -x & x < 0 \\end{cases}");
  const g = compile(f, ["x"]);
  near(g(2), 4);
  near(g(-3), 3);
  const h = compile(parse("\\begin{cases} 1 & 0 \\le x \\le 1 \\\\ 0 \\end{cases}"), ["x"]);
  near(h(0.5), 1);
  near(h(2), 0);
  assert.equal(parse("x^2+y^2=25").t, "rel");
});

test("Definitionen und benutzerdefinierte Funktionen", () => {
  const def = parse("f(x)=x^2+1");
  assert.equal(def.t, "def");
  if (def.t !== "def") return;
  const defs = { f: { params: def.params, body: def.body } };
  const use = parse("f(3)+f(1)", { functions: ["f"] });
  near(evalNumber(use, {}, defs), 12);
  near(evalNumber(parse("\\frac{d}{dx} f(x)", { functions: ["f"] }), { x: 3 }, defs), 6);
});

test("Matrizen und Tupel werden geparst und ausgegeben", () => {
  const m = parse("\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}");
  assert.equal(m.t, "matrix");
  assert.equal(toLatex(m), "\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}");
  assert.equal(parse("(1,2)").t, "tuple");
  assert.throws(() => parse("\\begin{pmatrix}1&2\\\\3\\end{pmatrix}"), ParseError);
});

test("Freie Symbole / Parametererkennung", () => {
  assert.deepEqual([...freeSymbols(parse("a\\sin(bx+c)"))].sort(), ["a", "b", "c", "x"]);
  assert.deepEqual([...freeSymbols(parse("\\sum_{k=1}^{n} k x"))].sort(), ["n", "x"]);
  assert.deepEqual([...freeSymbols(parse("\\pi r^2"))], ["r"]);
  assert.throws(() => compile(parse("a x"), ["x"]), (e: unknown) => e instanceof UndefinedSymbolError && e.symbol === "a");
});

test("Fehler: ungültige und unvollständige Eingaben", () => {
  const bad = (src: string, incomplete: boolean): void => {
    try {
      parse(src);
      assert.fail(`kein Fehler für ${src}`);
    } catch (e) {
      assert.ok(e instanceof ParseError, `falscher Fehlertyp für ${src}: ${e}`);
      assert.equal(e.incomplete, incomplete, `incomplete für ${src}`);
      assert.ok(e.message.length > 5);
      assert.ok(e.pos >= 0 && e.end > e.pos - 1);
    }
  };
  bad("\\frac{1}{", true);
  bad("x^", true);
  bad("1+", true);
  bad("(1+2", true);
  bad("\\int_0^1 x^2", true);
  bad("\\foo", false);
  bad(")", false);
  bad("x^-1", false);
  bad("\\sin(1,2)", false);
  bad("", true);
  bad("1 + $", false);
  bad("\\begin{cases} x & x>0", true);
});

test("Roundtrip: parse(toLatex(parse(s))) ist numerisch identisch", () => {
  const corpus = [
    "\\frac{x^2+1}{\\sqrt{x}+2}", "\\sin^2(x)+\\cos^2(x)", "2\\pi r", "e^{-x^2}", "\\frac{1}{1+e^{-x}}",
    "x^{\\frac{2}{3}}", "\\left|x\\right|^3", "3x^2-2x+1", "\\sqrt[3]{x+1}", "\\frac{\\ln x}{x}",
  ];
  for (const src of corpus) {
    const a: Expr = simplify(parse(src));
    const b: Expr = parse(toLatex(a));
    const fa = compile(a, ["x", "r"]);
    const fb = compile(b, ["x", "r"]);
    for (const x of [0.5, 1.5, 3.1]) near(fb(x, 2), fa(x, 2), 1e-12);
  }
});
