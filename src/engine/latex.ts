// AST -> LaTeX (Standardsyntax, KaTeX-kompatibel).
import { type Expr, GREEK, NEG1, num } from "./ast.ts";
import { sMul } from "./simplify.ts";

const TRIG = new Set(["sin", "cos", "tan", "cot", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh"]);
const BRACKETED = new Set(["abs", "floor", "ceil", "fact"]);
const REL_LATEX: Record<string, string> = { "=": "=", "<": "<", ">": ">", "<=": "\\leq", ">=": "\\geq", "!=": "\\neq" };
const MATRIX_ENV = { p: "pmatrix", b: "bmatrix", v: "vmatrix", "": "matrix" } as const;

export function nameLatex(name0: string): string {
  const pm = /^(.*?)('*)$/.exec(name0);
  const name = pm ? pm[1] : name0;
  const primes = pm ? pm[2] : ""; // f'(x): Ableitungsstriche bleiben als ' stehen
  const u = name.indexOf("_");
  const base = u > 0 ? name.slice(0, u) : name;
  const sub = u > 0 ? name.slice(u + 1) : "";
  const b = GREEK.has(base) || base === "infty" ? `\\${base}` : base.length > 1 ? `\\mathrm{${base}}` : base;
  if (!sub) return b + primes;
  return `${b}_{${GREEK.has(sub) ? `\\${sub}` : sub}}${primes}`;
}

function prec(e: Expr): number {
  switch (e.t) {
    case "add": return 1;
    case "mul":
      return termSign(e) < 0 ? 1 : 2;
    case "num": return e.n < 0n ? 1 : e.d !== 1n ? 2 : 4;
    case "pow": return 3;
    case "sum": case "prod": case "int": case "diff": case "lim":
    case "rel": case "cases": case "def": case "restrict":
      return 0;
    default: return 4;
  }
}

const paren = (s: string): string => `\\left(${s}\\right)`;
const wrap = (e: Expr, min: number): string => (prec(e) < min ? paren(toLatex(e)) : toLatex(e));

/** Gesamtvorzeichen eines Produkts über alle Zahlenfaktoren (auch in verschachtelten Produkten). */
function termSign(e: Expr): 1 | -1 {
  if (e.t === "num") return e.n < 0n ? -1 : 1;
  if (e.t === "mul") return e.args.reduce<1 | -1>((s, a) => (a.t === "num" || a.t === "mul" ? ((s * termSign(a)) as 1 | -1) : s), 1);
  return 1;
}

/** −e für einen Term mit negativem Gesamtvorzeichen: kehrt genau einen negativen Zahlenfaktor um. */
function flipNeg(e: Expr): Expr {
  if (e.t === "num") return num(-e.n, e.d);
  if (e.t === "mul") {
    const args = e.args.slice();
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a.t === "num" && a.n < 0n) {
        args[i] = num(-a.n, a.d);
        return { t: "mul", args };
      }
      if (a.t === "mul" && termSign(a) < 0) {
        args[i] = flipNeg(a);
        return { t: "mul", args };
      }
    }
  }
  return { t: "mul", args: [NEG1, e] };
}

const flattenMul = (args: Expr[]): Expr[] => args.flatMap((a) => (a.t === "mul" ? flattenMul(a.args) : [a]));

/** Würde der Ausdruck als Summe ausgegeben (dann braucht er beim Subtrahieren Klammern)? */
function isSumLike(e: Expr): boolean {
  if (e.t === "add") return true;
  if (e.t !== "mul") return false;
  const f = flattenMul(e.args);
  const nums = f.filter((a) => a.t === "num") as Extract<Expr, { t: "num" }>[];
  const rest = f.filter((a) => a.t !== "num");
  const one = nums.every((n) => n.n === 1n && n.d === 1n);
  return one && rest.length === 1 && rest[0].t === "add";
}

interface Piece {
  s: string;
  isNum: boolean;
}

function joinPieces(ps: Piece[]): string {
  let out = "";
  ps.forEach((p, i) => {
    if (i > 0) {
      const prev = ps[i - 1];
      if (prev.isNum && /^[0-9]/.test(p.s)) out += " \\cdot ";
      else if (/\\[A-Za-z]+$/.test(out) && /^[A-Za-z0-9]/.test(p.s)) out += " ";
    }
    out += p.s;
  });
  return out;
}

function printMul(args: Expr[]): string {
  let n = 1n;
  let d = 1n;
  let negative = false;
  const top: Expr[] = [];
  const bot: Expr[] = [];
  for (const a of flattenMul(args)) {
    if (a.t === "num") {
      if (a.n < 0n) {
        negative = !negative;
        n *= -a.n;
      } else n *= a.n;
      d *= a.d;
    } else if (a.t === "pow" && a.exp.t === "num" && a.exp.n < 0n) {
      const ne = num(-a.exp.n, a.exp.d);
      bot.push(ne.n === 1n && ne.d === 1n ? a.base : { t: "pow", base: a.base, exp: ne });
    } else top.push(a);
  }
  const numerPieces: Piece[] = [];
  if (n !== 1n || top.length === 0) numerPieces.push({ s: n.toString(), isNum: true });
  const topWrapped = top.length + numerPieces.length > 1;
  for (const a of top) numerPieces.push({ s: topWrapped ? wrap(a, 2) : toLatex(a), isNum: false });
  const denPieces: Piece[] = [];
  if (d !== 1n) denPieces.push({ s: d.toString(), isNum: true });
  const botWrapped = bot.length + denPieces.length > 1;
  for (const a of bot) denPieces.push({ s: botWrapped ? wrap(a, 2) : toLatex(a), isNum: false });
  let numer = joinPieces(numerPieces);
  if (negative && !denPieces.length && n === 1n && top.length === 1 && top[0].t === "add") numer = paren(numer);
  const body = denPieces.length ? `\\frac{${numer}}{${joinPieces(denPieces)}}` : numer;
  return negative ? `-${body}` : body;
}

function printPow(base: Expr, exp: Expr): string {
  if (exp.t === "num") {
    if (exp.n === 1n && exp.d !== 1n) {
      return exp.d === 2n ? `\\sqrt{${toLatex(base)}}` : `\\sqrt[${exp.d}]{${toLatex(base)}}`;
    }
    if (exp.n < 0n) {
      const ne = num(-exp.n, exp.d);
      const inner: Expr = ne.n === 1n && ne.d === 1n ? base : { t: "pow", base, exp: ne };
      return `\\frac{1}{${toLatex(inner)}}`;
    }
  }
  if (base.t === "sym" && base.name === "e") return `e^{${toLatex(exp)}}`;
  if (base.t === "fn" && TRIG.has(base.name) && exp.t === "num" && exp.d === 1n && exp.n > 0n) {
    return `\\${base.name}^{${exp.n}}${paren(base.args.map(toLatex).join(", "))}`;
  }
  const b = base.t === "fn" && !BRACKETED.has(base.name) ? paren(toLatex(base)) : wrap(base, 4);
  return `${b}^{${toLatex(exp)}}`;
}

function printFn(name: string, args: Expr[]): string {
  const list = args.map(toLatex).join(", ");
  if (TRIG.has(name) || name === "ln" || name === "min" || name === "max") return `\\${name}${paren(list)}`;
  switch (name) {
    case "abs": return `\\left|${list}\\right|`;
    case "floor": return `\\left\\lfloor ${list}\\right\\rfloor`;
    case "ceil": return `\\left\\lceil ${list}\\right\\rceil`;
    case "round": return `\\operatorname{round}${paren(list)}`;
    case "sign": return `\\operatorname{sgn}${paren(list)}`;
    case "fact": return `${wrap(args[0], 4)}!`;
    default: return `${nameLatex(name)}${paren(list)}`;
  }
}

export function toLatex(e: Expr): string {
  switch (e.t) {
    case "num": {
      if (e.d === 1n) return e.n.toString();
      return `${e.n < 0n ? "-" : ""}\\frac{${e.n < 0n ? -e.n : e.n}}{${e.d}}`;
    }
    case "sym":
      return nameLatex(e.name);
    case "add": {
      let s = wrap(e.args[0], 1);
      for (let i = 1; i < e.args.length; i++) {
        const t = e.args[i];
        if (termSign(t) < 0) {
          const pos = flipNeg(t);
          s += isSumLike(pos) ? ` - ${paren(toLatex(pos))}` : ` - ${wrap(pos, 2)}`;
        } else s += ` + ${wrap(t, 1)}`;
      }
      return s;
    }
    case "mul":
      return printMul(e.args);
    case "pow":
      return printPow(e.base, e.exp);
    case "fn":
      return printFn(e.name, e.args);
    case "sum":
    case "prod":
      return `\\${e.t}_{${nameLatex(e.v)}=${toLatex(e.from)}}^{${toLatex(e.to)}} ${wrap(e.body, 2)}`;
    case "int": {
      const lim = `${e.from ? `_{${toLatex(e.from)}}` : ""}${e.to ? `^{${toLatex(e.to)}}` : ""}`;
      return `\\int${lim} ${toLatex(e.body)} \\, d${nameLatex(e.v)}`;
    }
    case "diff": {
      const v = nameLatex(e.v);
      const head = e.order === 1 ? `\\frac{d}{d${v}}` : `\\frac{d^{${e.order}}}{d${v}^{${e.order}}}`;
      return `${head} ${wrap(e.body, 3)}`;
    }
    case "lim": {
      const dir = e.dir ? `^{${e.dir}}` : "";
      return `\\lim_{${nameLatex(e.v)} \\to ${toLatex(e.to)}${dir}} ${wrap(e.body, 2)}`;
    }
    case "rel": {
      let s = toLatex(e.args[0]);
      e.ops.forEach((op, i) => (s += ` ${REL_LATEX[op] ?? op} ${toLatex(e.args[i + 1])}`));
      return s;
    }
    case "cases":
      return `\\begin{cases} ${e.rows.map((r) => (r.cond ? `${toLatex(r.value)} & ${toLatex(r.cond)}` : toLatex(r.value))).join(" \\\\ ")} \\end{cases}`;
    case "matrix": {
      const env = MATRIX_ENV[e.delim];
      return `\\begin{${env}} ${e.rows.map((r) => r.map(toLatex).join(" & ")).join(" \\\\ ")} \\end{${env}}`;
    }
    case "tuple":
      return paren(e.items.map(toLatex).join(", "));
    case "def":
      return `${nameLatex(e.name)}${paren(e.params.map(nameLatex).join(", "))} = ${toLatex(e.body)}`;
    case "restrict": {
      const cond = e.cond.t === "tuple" ? e.cond.items.map(toLatex).join(", ") : toLatex(e.cond);
      return `${toLatex(e.body)} \\left\\{ ${cond} \\right\\}`;
    }
  }
}

/** Gleitkommazahl als LaTeX (Näherungswert, 12 signifikante Stellen). */
export function numberToLatex(x: number, digits = 12): string {
  if (Number.isNaN(x)) return "\\text{undefiniert}";
  if (!Number.isFinite(x)) return x > 0 ? "\\infty" : "-\\infty";
  if (x === 0) return "0";
  const s = Number(x.toPrecision(digits)).toString();
  if (s.includes("e")) {
    const [m, ex] = s.split("e");
    return `${m} \\times 10^{${Number(ex)}}`;
  }
  return s;
}
