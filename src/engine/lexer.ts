export type TokKind = "num" | "id" | "cmd" | "op" | "name" | "eof";
export interface Token {
  k: TokKind;
  s: string;
  pos: number;
  end: number;
}

export class ParseError extends Error {
  pos: number;
  end: number;
  incomplete: boolean;
  constructor(message: string, pos: number, end: number, incomplete = false) {
    super(message);
    this.name = "ParseError";
    this.pos = pos;
    this.end = end;
    this.incomplete = incomplete;
  }
}

const SPACING = new Set([",", ";", ":", "!", " "]);
const NAMED_ARG_CMDS = new Set(["begin", "end", "operatorname", "mathrm", "text"]);
const SKIP_CMDS = new Set(["quad", "qquad", "displaystyle", "textstyle", "limits", "nolimits"]);
const OPS = "+-*/^_!=<>()[]{}|,;&'.";

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= "0" && c <= "9";
const isLetter = (c: string | undefined): boolean => c !== undefined && /[A-Za-z]/.test(c);

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (isDigit(c) || (c === "." && isDigit(src[i + 1]))) {
      let j = i;
      while (isDigit(src[j])) j++;
      if (src[j] === "." && isDigit(src[j + 1])) {
        j++;
        while (isDigit(src[j])) j++;
      }
      out.push({ k: "num", s: src.slice(i, j), pos: i, end: j });
      i = j;
      continue;
    }
    if (isLetter(c)) {
      out.push({ k: "id", s: c, pos: i, end: i + 1 });
      i++;
      continue;
    }
    if (c === "\\") {
      const nx = src[i + 1];
      if (nx === undefined) throw new ParseError("Unvollständiger Befehl am Ende der Eingabe", i, i + 1, true);
      if (isLetter(nx)) {
        let j = i + 1;
        while (isLetter(src[j])) j++;
        const name = src.slice(i + 1, j);
        if (SKIP_CMDS.has(name)) {
          i = j;
          continue;
        }
        if (name === "lvert" || name === "rvert") {
          out.push({ k: "op", s: "|", pos: i, end: j });
          i = j;
          continue;
        }
        out.push({ k: "cmd", s: name, pos: i, end: j });
        i = j;
        if (NAMED_ARG_CMDS.has(name)) {
          let m = i;
          while (m < n && /\s/.test(src[m])) m++;
          if (src[m] === "{") {
            const close = src.indexOf("}", m);
            if (close < 0) throw new ParseError("Fehlende schließende Klammer }", m, n, true);
            out.push({ k: "name", s: src.slice(m + 1, close).trim(), pos: m, end: close + 1 });
            i = close + 1;
          }
        }
        continue;
      }
      if (SPACING.has(nx)) {
        i += 2;
        continue;
      }
      if (nx === "\\") {
        out.push({ k: "cmd", s: "\\", pos: i, end: i + 2 });
        i += 2;
        continue;
      }
      if (nx === "{" || nx === "}" || nx === "|") {
        out.push({ k: "cmd", s: nx, pos: i, end: i + 2 });
        i += 2;
        continue;
      }
      throw new ParseError(`Unbekannter Befehl \\${nx}`, i, i + 2);
    }
    if (OPS.includes(c)) {
      out.push({ k: "op", s: c, pos: i, end: i + 1 });
      i++;
      continue;
    }
    throw new ParseError(`Unerwartetes Zeichen „${c}“`, i, i + 1);
  }
  out.push({ k: "eof", s: "", pos: n, end: n });
  return out;
}
