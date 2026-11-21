// LaTeX -> AST. Kein eval, kein String-Rewriting: ein echter rekursiver Abstiegsparser.
import {
  type Expr, GREEK, ONE, NEG1, num, numFromString, sym, add, mul, pow, fn, EngineError,
} from "./ast.ts";
import { tokenize, ParseError } from "./lexer.ts";
import type { Token } from "./lexer.ts";

export { ParseError };

export interface ParseOptions {
  /** Namen benutzerdefinierter Funktionen, damit f(x) als Aufruf (statt f·(x)) gelesen wird. */
  functions?: Iterable<string>;
}

const FUNCS = new Set([
  "sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan",
  "sinh", "cosh", "tanh", "ln", "log", "exp", "min", "max",
]);
const INVERSE: Record<string, string> = { sin: "arcsin", cos: "arccos", tan: "arctan" };
const STARTERS = new Set([
  "frac", "dfrac", "tfrac", "sqrt", "left", "sum", "prod", "int", "lim", "lfloor", "lceil",
  "begin", "operatorname", "mathrm", "infty",
]);
const REL_OPS = new Map<string, string>([["=", "="], ["<", "<"], [">", ">"]]);
const REL_CMDS = new Map<string, string>([
  ["leq", "<="], ["le", "<="], ["geq", ">="], ["ge", ">="], ["neq", "!="], ["ne", "!="],
]);
const MATRIX_ENVS: Record<string, "p" | "b" | "v" | ""> = {
  pmatrix: "p", bmatrix: "b", vmatrix: "v", matrix: "",
};
const NAMED_FN: Record<string, string> = { sgn: "sign", sign: "sign", floor: "floor", ceil: "ceil", round: "round", abs: "abs" };

export function parse(src: string, opts: ParseOptions = {}): Expr {
  const p = new Parser(tokenize(src), new Set(opts.functions ?? []));
  return p.parseAll();
}

function describe(t: Token): string {
  if (t.k === "eof") return "Ende der Eingabe";
  if (t.k === "cmd") return "\\" + t.s;
  return `„${t.s}“`;
}

const negate = (e: Expr): Expr => (e.t === "num" ? num(-e.n, e.d) : mul(NEG1, e));

class Parser {
  toks: Token[];
  i = 0;
  fns: Set<string>;
  absDepth = 0;
  intDepth = 0;

  constructor(toks: Token[], fns: Set<string>) {
    this.toks = toks;
    this.fns = fns;
  }

  peek(o = 0): Token {
    return this.toks[this.i + o] ?? this.toks[this.toks.length - 1];
  }
  next(): Token {
    const t = this.peek();
    if (this.i < this.toks.length - 1) this.i++;
    return t;
  }
  isOp(s: string, o = 0): boolean {
    const t = this.peek(o);
    return t.k === "op" && t.s === s;
  }
  isCmd(s: string, o = 0): boolean {
    const t = this.peek(o);
    return t.k === "cmd" && t.s === s;
  }
  err(msg: string, tok: Token = this.peek()): never {
    const incomplete = tok.k === "eof";
    throw new ParseError(
      incomplete ? `${msg} (Ausdruck ist unvollständig)` : msg,
      tok.pos,
      Math.max(tok.end, tok.pos + 1),
      incomplete,
    );
  }
  expectOp(s: string): void {
    if (!this.isOp(s)) this.err(`„${s}“ erwartet, gefunden: ${describe(this.peek())}`);
    this.next();
  }
  expectCmd(s: string): void {
    if (!this.isCmd(s)) this.err(`\\${s} erwartet, gefunden: ${describe(this.peek())}`);
    this.next();
  }

  parseAll(): Expr {
    if (this.peek().k === "eof") this.err("Leerer Ausdruck");
    const e = this.parseStatement();
    if (this.peek().k !== "eof") this.err(`Unerwartetes Zeichen: ${describe(this.peek())}`);
    return e;
  }

  // ---------- Anweisungen ----------
  parseStatement(): Expr {
    const t0 = this.peek();
    if (t0.k === "id" || (t0.k === "cmd" && GREEK.has(t0.s))) {
      const save = this.i;
      const snap = this.toks.slice();
      let def: { name: string; params: string[] } | null = null;
      try {
        const name = this.readName();
        if (this.isOp("(")) {
          this.next();
          const params: string[] = [this.readName()];
          while (this.isOp(",")) {
            this.next();
            params.push(this.readName());
          }
          this.expectOp(")");
          if (this.isOp("=")) {
            this.next();
            def = { name, params };
          }
        }
      } catch (e) {
        if (!(e instanceof ParseError)) throw e;
      }
      if (def) return { t: "def", name: def.name, params: def.params, body: this.withRestriction(this.parseExpr()) };
      this.i = save;
      this.toks = snap;
    }
    return this.withRestriction(this.parseRelation());
  }

  atRestriction(): boolean {
    return this.isCmd("{") || (this.isCmd("left") && this.isCmd("{", 1));
  }

  /** Definitionsbereich am Ende einer Zeile: \left\{ 0 \le t \le 1 \right\} (mehrere Bedingungen mit Komma = „und“). */
  withRestriction(e: Expr): Expr {
    if (!this.atRestriction()) return e;
    const left = this.isCmd("left");
    if (left) this.next();
    this.next();
    const save = this.absDepth;
    this.absDepth = 0;
    const items: Expr[] = [this.withRestriction(this.parseRelation())];
    while (this.isOp(",")) {
      this.next();
      items.push(this.withRestriction(this.parseRelation()));
    }
    this.absDepth = save;
    if (left) this.expectCmd("right");
    this.expectCmd("}");
    return { t: "restrict", body: e, cond: items.length === 1 ? items[0] : { t: "tuple", items } };
  }

  parseRelation(): Expr {
    const args: Expr[] = [this.parseExpr()];
    const ops: string[] = [];
    for (;;) {
      const t = this.peek();
      const op = t.k === "op" ? REL_OPS.get(t.s) : t.k === "cmd" ? REL_CMDS.get(t.s) : undefined;
      if (!op) break;
      this.next();
      ops.push(op);
      args.push(this.parseExpr());
    }
    return ops.length ? { t: "rel", ops, args } : args[0];
  }

  // ---------- Ausdrücke ----------
  parseExpr(): Expr {
    const terms: Expr[] = [this.parseTerm()];
    for (;;) {
      if (this.isOp("+")) {
        this.next();
        terms.push(this.parseTerm());
      } else if (this.isOp("-")) {
        this.next();
        terms.push(negate(this.parseTerm()));
      } else break;
    }
    return terms.length === 1 ? terms[0] : add(...terms);
  }

  parseTerm(): Expr {
    const args: Expr[] = [this.parseUnary()];
    for (;;) {
      const t = this.peek();
      if ((t.k === "cmd" && (t.s === "cdot" || t.s === "times")) || (t.k === "op" && t.s === "*")) {
        this.next();
        args.push(this.parseUnary());
      } else if ((t.k === "cmd" && t.s === "div") || (t.k === "op" && t.s === "/")) {
        this.next();
        args.push(pow(this.parseUnary(), NEG1));
      } else if (this.startsFactor()) {
        args.push(this.parsePower());
      } else break;
    }
    return args.length === 1 ? args[0] : mul(...args);
  }

  parseUnary(): Expr {
    if (this.isOp("-")) {
      this.next();
      return negate(this.parseUnary());
    }
    if (this.isOp("+")) {
      this.next();
      return this.parseUnary();
    }
    return this.parsePower();
  }

  parsePower(): Expr {
    const base = this.parsePostfix();
    if (this.isOp("^")) {
      this.next();
      return pow(base, this.parseArg());
    }
    return base;
  }

  parsePostfix(): Expr {
    let e = this.parsePrimary();
    while (this.isOp("!")) {
      this.next();
      e = fn("fact", e);
    }
    return e;
  }

  startsFactor(): boolean {
    const t = this.peek();
    switch (t.k) {
      case "num":
        return true;
      case "id": {
        if (this.intDepth > 0 && t.s === "d") {
          const n1 = this.peek(1);
          if (n1.k === "id" || (n1.k === "cmd" && GREEK.has(n1.s))) return false;
        }
        return true;
      }
      case "cmd":
        if (t.s === "left" && this.isCmd("{", 1)) return false;
        return STARTERS.has(t.s) || GREEK.has(t.s) || FUNCS.has(t.s);
      case "op":
        return t.s === "(" || (t.s === "|" && this.absDepth === 0);
      default:
        return false;
    }
  }

  /** Tiefgestelltes/hochgestelltes Argument bzw. \frac-Argument: Gruppe {…} oder ein einzelnes Token. */
  parseArg(): Expr {
    const t = this.peek();
    if (t.k === "op" && t.s === "{") {
      this.next();
      if (this.isOp("}")) this.err("Leere Gruppe {}");
      const save = this.absDepth;
      this.absDepth = 0;
      const e = this.parseExpr();
      this.absDepth = save;
      this.expectOp("}");
      return e;
    }
    if (t.k === "num") {
      if (t.s.includes(".") || t.s.length === 1) {
        this.next();
        return numFromString(t.s);
      }
      // LaTeX-Regel: x^23 bedeutet x^2 · 3 – nur die erste Ziffer gehört zum Exponenten
      this.toks[this.i] = { k: "num", s: t.s.slice(1), pos: t.pos + 1, end: t.end };
      return numFromString(t.s[0]);
    }
    if (t.k === "id") {
      this.next();
      return sym(t.s);
    }
    if (t.k === "cmd" && (GREEK.has(t.s) || t.s === "infty")) {
      this.next();
      return sym(t.s);
    }
    if (t.k === "op" && (t.s === "-" || t.s === "+")) {
      this.err("Vorzeichen im Exponenten bzw. Index bitte in geschweifte Klammern setzen, z. B. ^{-1}");
    }
    this.err(`Argument erwartet (Zeichen oder {…}), gefunden: ${describe(t)}`);
  }

  readName(): string {
    const t = this.peek();
    let base: string;
    if (t.k === "id") base = t.s;
    else if (t.k === "cmd" && GREEK.has(t.s)) base = t.s;
    else this.err(`Variablenname erwartet, gefunden: ${describe(t)}`);
    this.next();
    if (this.isOp("_")) {
      this.next();
      base += "_" + this.subscriptText();
    }
    return base;
  }

  subscriptText(): string {
    const t = this.peek();
    if (this.isOp("{")) {
      this.next();
      let s = "";
      while (!this.isOp("}")) {
        const u = this.next();
        if (u.k === "eof") this.err("Fehlende schließende Klammer }", u);
        if (u.k === "num" || u.k === "id") s += u.s;
        else if (u.k === "cmd" && GREEK.has(u.s)) s += u.s;
        else this.err("Im Index sind nur Buchstaben und Ziffern erlaubt", u);
      }
      this.next();
      if (!s) this.err("Leerer Index", t);
      return s;
    }
    if (t.k === "num") {
      this.next();
      return t.s[0] === undefined ? "" : t.s.slice(0, 1);
    }
    if (t.k === "id") {
      this.next();
      return t.s;
    }
    if (t.k === "cmd" && GREEK.has(t.s)) {
      this.next();
      return t.s;
    }
    this.err(`Index erwartet, gefunden: ${describe(t)}`);
  }

  atParenOpen(): boolean {
    return this.isOp("(") || (this.isCmd("left") && this.isOp("(", 1));
  }

  parseParenArgs(): Expr[] {
    const left = this.isCmd("left");
    if (left) this.next();
    this.expectOp("(");
    const save = this.absDepth;
    this.absDepth = 0;
    const args: Expr[] = [this.withRestriction(this.parseRelation())];
    while (this.isOp(",")) {
      this.next();
      args.push(this.withRestriction(this.parseRelation()));
    }
    this.absDepth = save;
    if (left) {
      this.expectCmd("right");
      this.expectOp(")");
    } else this.expectOp(")");
    return args;
  }

  // ---------- Primärausdrücke ----------
  parsePrimary(): Expr {
    const t = this.peek();
    switch (t.k) {
      case "num":
        this.next();
        return numFromString(t.s);
      case "id": {
        const name = this.readName();
        if (this.fns.has(name) && this.atParenOpen()) return fn(name, ...this.parseParenArgs());
        return sym(name);
      }
      case "op":
        return this.parseOpPrimary(t);
      case "cmd":
        return this.parseCmdPrimary(t);
      case "eof":
        return this.err("Ausdruck unvollständig");
      default:
        return this.err(`Unerwartetes Zeichen: ${describe(t)}`);
    }
  }

  parseOpPrimary(t: Token): Expr {
    if (t.s === "(" || t.s === "[") {
      this.next();
      const save = this.absDepth;
      this.absDepth = 0;
      const items: Expr[] = [this.withRestriction(this.parseRelation())];
      while (this.isOp(",")) {
        this.next();
        items.push(this.withRestriction(this.parseRelation()));
      }
      this.absDepth = save;
      if (t.s === "(") {
        if (!this.isOp(")")) this.err(`Fehlende schließende Klammer ) – gefunden: ${describe(this.peek())}`);
      } else if (!this.isOp("]") && !this.isOp(")")) {
        this.err(`Fehlende schließende Klammer ] – gefunden: ${describe(this.peek())}`);
      }
      this.next();
      return items.length === 1 ? items[0] : { t: "tuple", items };
    }
    if (t.s === "{") {
      this.next();
      if (this.isOp("}")) this.err("Leere Gruppe {}");
      const save = this.absDepth;
      this.absDepth = 0;
      const e = this.parseExpr();
      this.absDepth = save;
      this.expectOp("}");
      return e;
    }
    if (t.s === "|") {
      this.next();
      this.absDepth++;
      const e = this.parseExpr();
      this.absDepth--;
      if (!this.isOp("|")) this.err("Betragsstrich | zum Schließen fehlt");
      this.next();
      return fn("abs", e);
    }
    return this.err(`Unerwartetes Zeichen: ${describe(t)}`);
  }

  parseCmdPrimary(t: Token): Expr {
    const c = t.s;
    if (GREEK.has(c) || c === "infty") {
      const name = c === "infty" ? "infty" : this.readName();
      if (c === "infty") this.next();
      if (this.fns.has(name) && this.atParenOpen()) return fn(name, ...this.parseParenArgs());
      return sym(name);
    }
    if (c === "frac" || c === "dfrac" || c === "tfrac") {
      this.next();
      const d = this.tryDiffOperator();
      if (d) return d;
      const a = this.parseArg();
      const b = this.parseArg();
      return mul(a, pow(b, NEG1));
    }
    if (c === "sqrt") {
      this.next();
      let index: Expr = num(2);
      if (this.isOp("[")) {
        this.next();
        index = this.parseExpr();
        this.expectOp("]");
      }
      const x = this.parseArg();
      let exp: Expr;
      try {
        exp = index.t === "num" ? num(index.d, index.n) : pow(index, NEG1);
      } catch (e) {
        if (e instanceof EngineError) return this.err("Wurzelexponent darf nicht 0 sein", t);
        throw e;
      }
      return pow(x, exp);
    }
    if (FUNCS.has(c)) {
      this.next();
      return this.parseFunction(c, t);
    }
    if (c === "sum" || c === "prod") {
      this.next();
      return this.parseBigOp(c);
    }
    if (c === "int") {
      this.next();
      return this.parseIntegral();
    }
    if (c === "lim") {
      this.next();
      return this.parseLimit();
    }
    if (c === "left") return this.parseLeft();
    if (c === "lfloor" || c === "lceil") {
      this.next();
      const e = this.parseExpr();
      this.expectCmd(c === "lfloor" ? "rfloor" : "rceil");
      return fn(c === "lfloor" ? "floor" : "ceil", e);
    }
    if (c === "begin") return this.parseEnvironment();
    if (c === "operatorname" || c === "mathrm") {
      this.next();
      const nt = this.peek();
      if (nt.k !== "name") this.err(`\\${c}{…} erwartet einen Namen in geschweiften Klammern`, nt);
      this.next();
      const name = NAMED_FN[nt.s] ?? nt.s;
      if (this.atParenOpen()) return fn(name, ...this.parseParenArgs());
      return sym(nt.s);
    }
    return this.err(`Unbekannter oder hier nicht erlaubter Befehl \\${c}`, t);
  }

  parseLeft(): Expr {
    this.next();
    const open = this.next();
    let kind: string;
    if (open.k === "op" && (open.s === "(" || open.s === "[" || open.s === "|" || open.s === ".")) kind = open.s;
    else if (open.k === "cmd" && open.s === "{") kind = "{";
    else this.err(`Ungültiges Trennzeichen nach \\left: ${describe(open)}`, open);
    const save = this.absDepth;
    this.absDepth = 0;
    const items: Expr[] = [this.withRestriction(this.parseRelation())];
    while (this.isOp(",")) {
      this.next();
      items.push(this.withRestriction(this.parseRelation()));
    }
    this.absDepth = save;
    if (!this.isCmd("right")) this.err(`\\right erwartet, gefunden: ${describe(this.peek())}`);
    this.next();
    const close = this.next();
    const okClose = (close.k === "op" && ")]|.".includes(close.s)) || (close.k === "cmd" && close.s === "}");
    if (!okClose) this.err(`Ungültiges Trennzeichen nach \\right: ${describe(close)}`, close);
    if (kind === "|") {
      if (items.length !== 1) this.err("Betrag erwartet genau einen Ausdruck", open);
      return fn("abs", items[0]);
    }
    return items.length === 1 ? items[0] : { t: "tuple", items };
  }

  parseFunction(name: string, tok: Token): Expr {
    let sub: Expr | null = null;
    let exp: Expr | null = null;
    for (;;) {
      if (this.isOp("_")) {
        this.next();
        sub = this.parseArg();
      } else if (this.isOp("^")) {
        this.next();
        exp = this.parseArg();
      } else break;
    }
    if (sub && name !== "log") this.err(`Tiefgestellter Index ist bei \\${name} nicht erlaubt`, tok);
    let args: Expr[];
    if (this.atParenOpen()) args = this.parseParenArgs();
    else if (name === "min" || name === "max") this.err(`\\${name} erwartet Klammern, z. B. \\${name}(a, b)`);
    else args = [this.parseFuncArg()];
    if (name !== "min" && name !== "max" && args.length !== 1) {
      this.err(`\\${name} erwartet genau ein Argument`, tok);
    }
    const a = args[0];
    let node: Expr;
    const isNegOne = exp !== null && exp.t === "num" && exp.n === -1n && exp.d === 1n;
    if (isNegOne && INVERSE[name]) {
      node = fn(INVERSE[name], a);
      exp = null;
    } else {
      switch (name) {
        case "sec": node = pow(fn("cos", a), NEG1); break;
        case "csc": node = pow(fn("sin", a), NEG1); break;
        case "exp": node = pow(sym("e"), a); break;
        case "log": node = mul(fn("ln", a), pow(fn("ln", sub ?? num(10)), NEG1)); break;
        case "min":
        case "max": node = fn(name, ...args); break;
        default: node = fn(name, a);
      }
    }
    return exp ? pow(node, exp) : node;
  }

  atFunctionStart(): boolean {
    const t = this.peek();
    return t.k === "cmd" && FUNCS.has(t.s);
  }

  /** Argument ohne Klammern: \sin 2x = sin(2x), aber \sin x \cos x = sin(x)·cos(x). */
  parseFuncArg(): Expr {
    const parts: Expr[] = [];
    if (this.isOp("-")) {
      this.next();
      parts.push(negate(this.parsePower()));
    } else parts.push(this.parsePower());
    while (this.startsFactor() && !this.atFunctionStart()) parts.push(this.parsePower());
    return parts.length === 1 ? parts[0] : mul(...parts);
  }

  parseBigOp(kind: "sum" | "prod"): Expr {
    if (!this.isOp("_")) this.err(`\\${kind} erwartet eine Untergrenze, z. B. \\${kind}_{k=1}^{n}`);
    this.next();
    this.expectOp("{");
    const v = this.readName();
    this.expectOp("=");
    const from = this.parseExpr();
    this.expectOp("}");
    if (!this.isOp("^")) this.err(`\\${kind} erwartet eine Obergrenze, z. B. ^{n}`);
    this.next();
    const to = this.parseArg();
    const body = this.parseTerm();
    return { t: kind, v, from, to, body };
  }

  atDifferential(): boolean {
    const t = this.peek();
    const n1 = this.peek(1);
    return t.k === "id" && t.s === "d" && (n1.k === "id" || (n1.k === "cmd" && GREEK.has(n1.s)));
  }

  parseIntegral(): Expr {
    let from: Expr | null = null;
    let to: Expr | null = null;
    for (;;) {
      if (this.isOp("_")) {
        this.next();
        from = this.parseArg();
      } else if (this.isOp("^")) {
        this.next();
        to = this.parseArg();
      } else break;
    }
    this.intDepth++;
    let body: Expr;
    try {
      body = this.atDifferential() ? ONE : this.parseExpr();
    } finally {
      this.intDepth--;
    }
    if (!this.atDifferential()) this.err("Integral braucht ein Differential, z. B. \\, dx");
    this.next();
    const v = this.readName();
    return { t: "int", v, from, to, body };
  }

  parseLimit(): Expr {
    if (!this.isOp("_")) this.err("\\lim erwartet eine Angabe wie \\lim_{x \\to 0}");
    this.next();
    this.expectOp("{");
    const v = this.readName();
    if (!(this.isCmd("to") || this.isCmd("rightarrow"))) this.err("\\to erwartet");
    this.next();
    const start = this.i;
    let depth = 1;
    let j = start;
    while (depth > 0) {
      const tk = this.toks[j];
      if (!tk || tk.k === "eof") this.err("Fehlende schließende Klammer }", tk ?? this.peek());
      if (tk.k === "op" && tk.s === "{") depth++;
      if (tk.k === "op" && tk.s === "}") depth--;
      j++;
    }
    let inner = this.toks.slice(start, j - 1);
    let dir: "" | "+" | "-" = "";
    const L = inner.length;
    const sgn = (tk: Token | undefined): "+" | "-" | "" => (tk && tk.k === "op" && (tk.s === "+" || tk.s === "-") ? (tk.s as "+" | "-") : "");
    if (L >= 2 && inner[L - 2].k === "op" && inner[L - 2].s === "^" && sgn(inner[L - 1])) {
      dir = sgn(inner[L - 1]);
      inner = inner.slice(0, L - 2);
    } else if (
      L >= 4 && inner[L - 4].k === "op" && inner[L - 4].s === "^" && inner[L - 3].s === "{" &&
      sgn(inner[L - 2]) && inner[L - 1].s === "}"
    ) {
      dir = sgn(inner[L - 2]);
      inner = inner.slice(0, L - 4);
    }
    const last = inner.length ? inner[inner.length - 1] : this.peek();
    const sub = new Parser([...inner, { k: "eof", s: "", pos: last.end, end: last.end }], this.fns);
    const to = sub.parseAll();
    this.i = j;
    const body = this.parseTerm();
    return { t: "lim", v, to, dir, body };
  }

  tryDiffOperator(): Expr | null {
    const save = this.i;
    const snap = this.toks.slice();
    const isD = (t: Token): boolean => (t.k === "id" && t.s === "d") || (t.k === "cmd" && t.s === "partial");
    let header: { v: string; order: number } | null = null;
    try {
      if (this.isOp("{")) {
        this.next();
        const t1 = this.next();
        if (isD(t1)) {
          let order = 1;
          if (this.isOp("^")) {
            this.next();
            order = this.smallInt();
          }
          this.expectOp("}");
          this.expectOp("{");
          const t2 = this.next();
          if (isD(t2) && t2.k === t1.k) {
            const v = this.readName();
            let order2 = 1;
            if (this.isOp("^")) {
              this.next();
              order2 = this.smallInt();
            }
            this.expectOp("}");
            if (order === order2) header = { v, order };
          }
        }
      }
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
    }
    if (!header) {
      this.i = save;
      this.toks = snap;
      return null;
    }
    const body = this.parseTerm();
    return { t: "diff", v: header.v, order: header.order, body };
  }

  smallInt(): number {
    const e = this.parseArg();
    if (e.t !== "num" || e.d !== 1n || e.n < 1n || e.n > 20n) this.err("Ableitungsordnung muss eine ganze Zahl von 1 bis 20 sein");
    return Number(e.n);
  }

  parseEnvironment(): Expr {
    const beginTok = this.next();
    const nt = this.peek();
    if (nt.k !== "name") this.err("\\begin{…} erwartet einen Umgebungsnamen", nt);
    this.next();
    const env = nt.s;
    const isCases = env === "cases";
    if (!isCases && !(env in MATRIX_ENVS)) this.err(`Umgebung „${env}“ wird nicht unterstützt`, nt);
    const rowsM: Expr[][] = [];
    const rowsC: { value: Expr; cond: Expr | null }[] = [];
    let row: Expr[] = [];
    const save = this.absDepth;
    this.absDepth = 0;
    for (;;) {
      if (isCases) {
        const value = this.parseExpr();
        let cond: Expr | null = null;
        if (this.isOp("&")) {
          this.next();
          cond = this.parseRelation();
        }
        rowsC.push({ value, cond });
      } else {
        row.push(this.parseExpr());
        if (this.isOp("&")) {
          this.next();
          continue;
        }
        rowsM.push(row);
        row = [];
      }
      if (this.isCmd("\\")) {
        this.next();
        if (this.isCmd("end")) break;
        continue;
      }
      if (this.isCmd("end")) break;
      this.err(`Unerwartetes Zeichen in \\begin{${env}}: ${describe(this.peek())}`);
    }
    this.absDepth = save;
    this.expectCmd("end");
    const et = this.peek();
    if (et.k !== "name" || et.s !== env) this.err(`\\end{${env}} erwartet`, et.k === "eof" ? et : beginTok);
    this.next();
    if (isCases) return { t: "cases", rows: rowsC };
    const width = rowsM[0].length;
    if (rowsM.some((r) => r.length !== width)) this.err("Alle Matrixzeilen müssen gleich viele Einträge haben", beginTok);
    return { t: "matrix", rows: rowsM, delim: MATRIX_ENVS[env] };
  }
}
