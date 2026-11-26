# Übergabedokument – Mathe-App (Desmos × GeoGebra als Windows-Desktop-App)

Stand: Ende der Entwicklungssitzung „Fehlersuche und Grenzen verbessern“. Dieses Dokument ersetzt das Gesprächsprotokoll.
Es beschreibt den **tatsächlichen** Zustand des Projekts (58 Tests grün, Typcheck sauber). Wo etwas nicht verifiziert ist, steht es ausdrücklich dabei.

---

## 0. Kontext und Arbeitsweise (wichtig für die Fortsetzung)

- **Nutzer**: spricht Deutsch, erwartet deutsche Antworten, deutsche UI-Texte und deutsche Fehlermeldungen. Er will zügigen, selbstständigen Fortschritt („mach das“, „weiter“) und ehrliche Aussagen darüber, was geprüft ist und was nicht.
- **Kein Claude Code**: Der Nutzer hat nur den kostenlosen Account. Entwicklung läuft im Chat; Code wird als `mathe-app.zip` geliefert. Der Nutzer entpackt, committet/pusht mit **GitHub Desktop** in ein privates Repo (Branch `main`); **GitHub Actions** baut dort die Windows-`.exe`. Er meldet Build-Fehler zurück (rote Schritte kopieren).
- **Umgebung der KI (Chat-Container)**: Linux, **kein Netzwerk** (kein `npm install`, kein `cargo`, kein Tauri-Build, keine Windows-Tests), Node 22, globales `tsc`. Deshalb gilt: Die **React-/Tauri-Oberfläche wurde nie in einem echten Browser/WebView ausgeführt**, nur typgeprüft (mit Ersatz-Typdeklarationen, siehe 8.3) und mit einem Mock-Canvas getestet. Die gesamte Rechen- und Zeichenlogik (`src/engine`, `src/analysis`, `src/graph`) ist dagegen rein und wird mit `node` getestet.
- **Letzter bestätigte CI-Erfolg**: Der Nutzer bestätigte, dass der **erste Build (nur Gerüst: LaTeX-Eingabefeld + KaTeX)** durchlief und die App startete. Für alle späteren Versionen (Engine, Graph, Slider, Analyse) hat der Nutzer **keinen Build-Erfolg gemeldet** – das ist der erste Punkt der nächsten Schritte (Abschnitt 9, Schritt 0).
- **Arbeitsstil, der sich bewährt hat**: erst Logik als reine Module + Tests, dann UI; jede Behauptung „exakt“ muss bewiesen sein; Zufallstests (Fuzzing) finden echte Fehler; nach jeder Änderung `npm test` + Typcheck; Ergebnis als Zip in `/mnt/user-data/outputs/mathe-app.zip` mit `present_files`; README aktuell halten.

---

## 1. Projektüberblick

**Ziel (Originalauftrag, gekürzt)**: Professionelle mathematische Desktop-App, die den **Desmos Graphing Calculator** und **GeoGebra** kombiniert (Schul- bis Uni-Mathematik), **Standard-LaTeX als universelles Ein- und Ausgabeformat**, LaTeX → **AST** → symbolische/numerische Berechnung, **vollständig offline**, **Windows-.exe** (Installer + portabel), Tauri 2 + React + TypeScript, KaTeX-Rendering, kein `eval` von Nutzereingaben, Mathematik-Korrektheit vor Funktionsumfang. Entwicklungsreihenfolge laut Auftrag: (1) Editor/Rendering, (2) Parser/AST, (3) Rechenengine, (4) Graph-Rendering, (5) Ausdruckspanel, (6) Slider, (7) Analyse, (8) Geometrie, (9) Zusatztools (komplexe Zahlen, Vektoren, Folgen, Matrizen), (10) Projekte/Export, (11) UI-Feinschliff, (12) Windows-Paketierung.

**Technologie**: Tauri 2 (Rust-Seite minimal: `src-tauri/src/lib.rs` startet nur das Fenster), React 18, TypeScript 5.5 (strict), Vite 5, KaTeX 0.16 (gebündelt), Canvas 2D. Tests mit `node:test` und `--experimental-strip-types` (kein Test-Framework installiert).

**Architektur (Schichten, Abhängigkeiten nur nach unten)**

```
UI (React)          App.tsx → GraphWorkspace.tsx → GraphView.tsx | CalcView.tsx | SliderRow.tsx | Tex.tsx
                      │ nutzt
Graph-Logik          src/graph/   (model, items, sampler, implicit, viewport, overlay, sliders, draw)
Analyse              src/analysis/ (function, format, sections)
Engine (rein)        src/engine/   (ast, lexer, parser, simplify, diff, eval, latex, poly, roots, integrate, solve, limits)
```

**Datenfluss**: Eingabetext (eine Zeile = ein Objekt, LaTeX) → `buildModel(src, sliderParams)` (parse, Definitionen, Parameter, Klassifikation) → `PlotModel{lines, items, params, missing}` → jedes `PlotItem.draw(view)` liefert `Shape[]` in Pixelkoordinaten → `drawItems` zeichnet. Analyse-Ergebnisse (`GraphWorkspace`) erzeugen zusätzliche Overlay-`PlotItem`s (Marker, Asymptoten, Flächen, Tangenten). Die Engine kennt weder React noch Canvas.

---

## 2. Dateistruktur (alle relevanten Dateien)

### Wurzel / Konfiguration
| Datei | Zweck |
|---|---|
| `package.json` | Skripte `dev`, `build` (`tsc && vite build`), `tauri`, `test` (`node --experimental-strip-types --test "tests/*.test.ts"`). Abhängigkeiten: react, react-dom, katex, @tauri-apps/api; dev: @tauri-apps/cli, vite, @vitejs/plugin-react, typescript, @types/*. **Kein `package-lock.json`** (CI nutzt `npm install`). |
| `tsconfig.json` | strict, ES2020, `jsx: react-jsx`, `allowImportingTsExtensions` (Importe enden auf `.ts`/`.tsx`), `include: ["src"]` – **Tests liegen außerhalb** und werden nicht von `tsc` geprüft. |
| `vite.config.ts`, `index.html` | Vite, Port 1420 strikt; `lang="de"`. |
| `app-icon.png` | 1024×1024-Quelle; CI erzeugt daraus `src-tauri/icons/*` (`npm run tauri icon app-icon.png`). |
| `.github/workflows/build-windows.yml` | `windows-latest`, Node 22, Rust stable, `npm install` → **`npm test`** → Icons → `npm run tauri build` → Artefakte `installer-nsis`, `installer-msi`, `portable-exe` (= `src-tauri/target/release/mathe-app.exe`). Trigger: Push auf `main` + manuell. |
| `src-tauri/tauri.conf.json` | Produktname „Mathe App“, Identifier `de.example.matheapp`, Fenster 1280×800, Ziele `nsis` + `msi`, `webviewInstallMode: offlineInstaller` (offline-tauglich), `csp: null`. |
| `src-tauri/Cargo.toml`, `build.rs`, `src/main.rs`, `src/lib.rs`, `capabilities/default.json` | Minimales Tauri-2-Gerüst (Lib `mathe_app_lib`, Binary `mathe-app`, Release-Profil mit LTO). **Keine eigenen Rust-Befehle.** |
| `README.md` | Nutzeranleitung (GitHub-Weg, Eingabekonventionen, Graph, Analyse); am Ende der Sitzung aktualisiert |
| `HANDOVER.md` | dieses Dokument |

### `src/engine/` (rein, ~3.800 Zeilen)
| Datei | Zweck |
|---|---|
| `ast.ts` | `Expr`-Union, `EngineError`, `UndefinedSymbolError`, Konstruktoren (`num`, `sym`, `add`, `mul`, `pow`, `fn`), `key`, `mapChildren`, `subst`, `freeSymbols`, `inlineDefs`, `numFromString`, `CONSTANTS`, `GREEK` |
| `lexer.ts` | `tokenize`, `ParseError{pos,end,incomplete}` |
| `parser.ts` | rekursiver Abstiegsparser `parse(src, {functions})` |
| `simplify.ts` | `simplify`, `expand(e, intoFunctions)`, `sAdd`, `sMul`, `sPow`, `sFn`, `neg`; ruft `derivative`, `integralNode`, `exactLimit` auf |
| `diff.ts` | `derivative(e, v, order)` |
| `eval.ts` | `compile`, `compileRelation`, `evalNumber`, `integrate` (Gauß–Kronrod), `limitNumeric`, `realPow`, `factorial`, `Context` |
| `latex.ts` | `toLatex`, `numberToLatex`, `nameLatex` |
| `poly.ts` | exakte Polynome über ℚ (`Rat`), `toPolynomial`, `rationalForm`, `rationalRoots`, `solvePolynomial`, `realRootsNumeric`, `polyDivMod`, `solveLinearRat`, `sqrtRat` |
| `roots.ts` | numerisch: `scanRoots`, `scanExtrema`, `findPoles`, `endBehavior`, `recognize` |
| `integrate.ts` | `antiderivative`, `definiteIntegral`, `integralNode` |
| `solve.ts` | `solveEquation`, `solveSystem` (inkl. `eliminate`), `bindParams`, `rationalOf`, `exactRoot` |
| `limits.ts` | `exactLimit` (nur über `simplify` genutzt, **nicht in `index.ts` exportiert**) |
| `index.ts` | Sammel-Export (ast, parse, simplify, derivative, compile…, toLatex, poly-/integrate-/solve-/roots-APIs) |

### `src/analysis/`
| Datei | Zweck |
|---|---|
| `function.ts` | `analyzeFunction`, `intersections` (explizit×explizit), `intersectCurves` (F(x,y)=0 beliebig), `tangentNormal`, `integralOf`, `areaBetween`; Typ `Pt` |
| `format.ts` | LaTeX-Aufbereitung: `entriesOf(FunctionAnalysis) → Entry[]`, `pointLatex`, `pointLine` (wieder einlesbar!), `plainPoint` |
| `sections.ts` | Rechner-Reiter ohne UI: `computeSections(src, range)` (Gleichung, System, Stammfunktion) |

### `src/graph/`
| Datei | Zweck |
|---|---|
| `viewport.ts` | `View`, Welt↔Pixel, `zoomAt`, `pan`, `setScale` (linear/log), `linearTicks`, `logTicks`, `formatTick`, `formatCoord` |
| `sampler.ts` | `samplePolylines` (adaptiv, explizite Funktionen), `sampleParametric` (parametrisch/polar) |
| `implicit.ts` | Marching Squares: `sampleGrid`, `contourLines` (verkettet, Polstellenfilter), `fillRects` |
| `items.ts` | `PlotItem`, `Shape`-Typen, Fabriken `explicitItem`, `parametricItem`, `polarItem`, `implicitItem`, `inequalityItem`, `inequalityExplicitItem`, `pointItem` |
| `overlay.ts` | `lineItem`, `markersItem`, `guidesItem`, `areaItem`, `relationItem` (Analyse-Zusatzobjekte) |
| `model.ts` | `buildModel`, `LineInfo`, `PlotModel`, `extractRange`, `PALETTE`; Klassifikation jeder Zeile |
| `sliders.ts` | `Slider`, `createSlider`, `stepSlider`, `setSliderValue`, `configureSlider`, `sliderParams` |
| `draw.ts` | Canvas-Zeichnung: `drawBackground` (Raster/Achsen/Beschriftung), `drawItems`, `drawMarker`, Themes `LIGHT`/`DARK` |

### `src/` (React-UI, ungeprüft im echten Browser)
| Datei | Zweck |
|---|---|
| `main.tsx` | Einstieg, importiert KaTeX-CSS und `styles.css` |
| `App.tsx` | Zustand `src` (Textarea), `tab` (graph/calc), `sliders`; `buildModel`; Liste der Zeilen mit LaTeX-Vorschau/Fehlern; Slider-Animation (`requestAnimationFrame`); `addLine` für „→ Zeile“ |
| `GraphWorkspace.tsx` | Graph + klappbares Analysepanel; Auswahl Funktion/zweite Kurve; Overlay-Items; Hover-Marker; Tangente, Schnittpunkte, Integral/Fläche |
| `GraphView.tsx` | Canvas, Ansicht (`View`) als State, native Pointer-/Wheel-/Tastatur-Listener, `ResizeObserver`, DPR, Werkzeugleiste (Bereich, log, Raster, 1:1), Statuszeile, Klick-Auswahl |
| `CalcView.tsx` | Rechner-Reiter: exakt vereinfacht, Näherung, Ableitung, + `SolveSections`; Suchbereich einstellbar |
| `SolveSections.tsx` | Darstellung von `computeSections` |
| `SliderRow.tsx` | ein Slider (Bereich, Schritt, Modus, Geschwindigkeit, ▶/⏸) |
| `Tex.tsx` | KaTeX-Wrapper (`inline` oder Block) |
| `styles.css` | Hell/Dunkel per `prefers-color-scheme` |

### `tests/` (58 Tests, alle grün)
`engine.test.ts` (14: Parser, Präzedenz, exakte Arithmetik, Ableitung, Integrale, Definitionsbereich …), `graph.test.ts` (11: Viewport, Raster, Sampler, Zeichnen mit Mock-Kontext, Leistung), `curves.test.ts` (11: Modell-Klassifikation, implizit, Ungleichungen, parametrisch, polar, Slider), `analysis.test.ts` (13: Polynome, Suche, Analyse, Schnittpunkte, Systeme, Integration, Tangente, Fläche, Rechner-Abschnitte, Overlays), `improve.test.ts` (9: Grenzwerte, kubische Wurzeln, Systeme per Elimination, Ableitungsstriche, Druck-Regression, seeded Zufallstest, Rechnerbereich).

---

## 3. Implementierungsdetails

### 3.1 AST (`ast.ts`)
`Expr` = `num{n,d: bigint}` (**exakte rationale Zahlen**, immer gekürzt, `d>0`) | `sym{name}` | `add{args}` | `mul{args}` | `pow{base,exp}` | `fn{name,args}` | `sum|prod{v,from,to,body}` | `int{v,from|null,to|null,body}` | `diff{v,order,body}` | `lim{v,to,dir:""|"+"|"-",body}` | `rel{ops[],args[]}` (Ops: `=`,`<`,`>`,`<=`,`>=`,`!=`; Ketten wie `0<y<x`) | `cases{rows[{value,cond|null}]}` | `matrix{rows,delim}` | `tuple{items}` | `def{name,params,body}` | `restrict{body,cond}` (Definitionsbereich).

Kanonische Formen: Negation `mul(-1,x)`, Differenz = Summe, Division `pow(x,-1)`, Wurzel `pow(x,1/n)`, `\exp(x)=pow(e,x)`, `\sec=pow(cos,-1)`, `\csc=pow(sin,-1)`, `\log_b x = ln x · ln(b)^-1` (**`\log` = Basis 10**). Funktionsnamen: `sin cos tan cot arcsin arccos arctan sinh cosh tanh ln abs floor ceil round sign fact min max` + benutzerdefinierte (Ableitungen heißen `f'`, `f''`). Konstanten (`CONSTANTS`): `pi e tau infty`. Indizierte Symbole sind Strings (`a_1`); `subst` ersetzt in `a_k` den Index, wenn `k` durch eine ganze Zahl ersetzt wird. `key(e)` = JSON-Schlüssel für Gleichheit/Sortierung.

### 3.2 Parser (`lexer.ts`, `parser.ts`)
- Einzelne Buchstaben sind eigene Token (`xy` = x·y, wie in LaTeX); `\operatorname{…}`/`\mathrm{…}`/`\begin{…}` liefern ein `name`-Token. Spacing-Befehle (`\,`, `\;`, `\quad` …) werden verworfen.
- Grammatik: `parseStatement` (Definitionserkennung `f(x)=…`, danach Relation, danach `withRestriction` für `\left\{ … \right\}`) → `parseRelation` → `parseExpr` (±) → `parseTerm` (explizite `\cdot`, `\times`, `\div`, `/`; **implizite Multiplikation** via `startsFactor`) → `parseUnary` (Minus vor Zahl wird eingefaltet) → `parsePower` (`^` mit `parseArg`) → `parsePostfix` (`!`) → `parsePrimary`.
- LaTeX-Regeln: `x^23` = x²·3 (nur erste Ziffer gehört zum Exponenten), Vorzeichen im Exponenten nur in `{}` (`^{-1}`), `\frac12` erlaubt. `\sin 2x` = sin(2x), `\sin x\cos x` = sin x·cos x (Argument ohne Klammern bricht vor der nächsten Funktion ab), `\sin^{-1}` = arcsin, `\sin^2 x`.
- `\int … dx`: `intDepth` und `startsFactor` beenden den Integranden vor `d`+Variable. `\sum_{k=1}^{n}`, `\prod`, `\lim_{x\to a^+}` (Richtung per Teilparser), `\frac{d}{dx}` / `\frac{d^2}{dx^2}` / `\partial` (`tryDiffOperator`, bezieht sich auf den folgenden Term), Umgebungen `pmatrix bmatrix vmatrix matrix cases`, Beträge `|…|` (`absDepth`; in `\left|…\right|` verschachtelbar), `\lfloor \rfloor \lceil \rceil`.
- `parse(src, {functions: names})`: `f(3)` ist nur dann ein Aufruf, wenn `f` bekannt ist; `f'(x)` (Ableitungsstriche) nur bei bekannten Funktionen → `fn("f'", …)`.
- Fehler: `ParseError(message, pos, end, incomplete)`; `incomplete` bei Eingabeende. **Nicht unterstützt**: `\vec`, `\overline`, komplexes `i`, `\mathrm{d}` als Differential, Funktionen mit Mehrbuchstabennamen ohne `\operatorname`, Listen, 3D-Tupel (werden geparst, aber nicht gezeichnet).

### 3.3 Vereinfachen (`simplify.ts`)
- `sAdd`: flacht ab, fasst gleiche Terme (Schlüssel ohne Zahlenfaktor) zusammen, **verteilt `Zahl·(Summe)` innerhalb von Summen** (sonst heben sich `x-(x+1)` nicht auf), sortiert nach Grad absteigend (`degreeOf`), dann nach Term ohne Koeffizient, **Konstanten zuletzt**.
- `sMul`: Zahlenfaktor vorn, gleiche Basen werden durch Exponentensumme zusammengefasst; Reihenfolge `rankMul`: Konstanten (`π`, `e`) → Variablen alphabetisch → `e^{…}` und Funktionen → Summen → Rest. Ein einzelnes `-(a+b)` bleibt faktorisiert (nur in Summen wird verteilt).
- `sPow`: `x^0`, `x^1`, exakte Zahlenpotenzen (`exactPow`: ganzzahlig, perfekte n-te Wurzeln, `√8 = 2√2` für Quadratwurzeln ganzer Zahlen ≤ 10⁹), `(b^a)^n → b^{an}` für ganzzahliges n, `(Produkt)^n` verteilt, `e^{ln u} = u`.
- `sFn`: exakte Sonderwerte (abs, sign, floor, ceil, round, Fakultät ≤ 400, `ln 1`, `ln e`, `sin/cos/tan` bei Vielfachen von π/12 über eine Tabelle k∈{0,2,3,4,6}, einfache Umkehrfunktionswerte, `abs(e)=e`).
- `simplify`: Summen/Produkte mit festen Grenzen werden ausgeschrieben (≤ 100 000 Glieder); `diff` → `derivative`; `lim` → `exactLimit` (sonst Knoten bleibt); `int` → `integralNode` (sonst Knoten bleibt).
- **Bereichserweiterung** (bewusst, wie übliche CAS): `(√x)²→x`, `x^{1/2}·x^{1/2}→x`. Deshalb nutzt die Analyse für numerische Suche den **ungekürzten** Ausdruck (`bound.expr`).
- `expand(e, intoFunctions=true)`: multipliziert aus, entwickelt ganzzahlige Potenzen von Summen (≤ 50, ≤ 20 000 Terme) **Term für Term** (nicht über `sMul`, sonst Rekursion). Mit `false` bleiben Funktionsargumente unberührt (genutzt für Stammfunktionen).

### 3.4 Ableitung, Auswertung, Ausgabe
- `diff.ts`: Summen-, Produkt-, Potenzregel (3 Fälle), Kettenregel-Tabelle (sin … tanh, ln, abs→sign, floor/ceil/round/sign→0), Summe mit festen Grenzen, Hauptsatz (Integral mit Parametergrenzen), `cases`, `restrict`, `tuple`. Unbekannte Funktion → `EngineError "Keine Ableitungsregel"`.
- `eval.ts`: `compile(e, vars, {params, defs})` baut einen **Closure-Baum** (kein `eval`/`new Function`). Unbekannte Symbole werfen beim Kompilieren `UndefinedSymbolError(symbol)` (Grundlage für „Slider anlegen“). Benutzerfunktionen werden über `defs` aufgerufen (Rekursion → `EngineError "Rekursive Definition"`). `realPow`: negative Basis mit rationalem Exponenten und ungeradem Nenner liefert die reelle Wurzel (`(-8)^{1/3}=-2`). `integrate`: adaptives G7K15, ±∞ über Substitution, Budget 400 000 Auswertungen. `limitNumeric`: zweiseitig gemittelt, einseitig Richardson, **Divergenzerkennung** (±∞), bei ±∞ Vergleich f(10⁶)/f(10⁸) inkl. „langsam gegen 0“.
- `latex.ts`: Drucker mit Präzedenz `prec`; Brüche (negative Exponenten → Nenner), Wurzeln, `\sin^{2}\left(x\right)`-Stil, Trig-Potenzen, `\left|…\right|`, Relationen, `cases`, Matrizen, `restrict`, Funktionsnamen mit Strichen (`f'`). **Kritisch**: Der Drucker muss mit **nicht vereinfachten** Parser-ASTs korrekt arbeiten (`termSign`, `flipNeg`, `flattenMul`, `isSumLike` – Gesamtvorzeichen über alle Zahlenfaktoren, Klammern beim Subtrahieren von Summen). **Invariante**: Jede `toLatex`-Ausgabe muss wieder einlesbar sein und denselben Wert ergeben („→ Zeile“ hängt davon ab; getestet).

### 3.5 Polynome, Nullstellen, Integration, Löser, Grenzwerte
- `poly.ts`: `toPolynomial(e,v)` (nach `expand`; andere Symbole → `null`), `rationalForm(e,v,simplifyFirst=true)` (P/Q; mit `false` bleiben Nenner wie `x²/x` erhalten), `rationalRoots` (Satz über rationale Nullstellen, Teiler nur bis 10¹²), `solvePolynomial`: rational → quadratisch (Wurzelausdruck) → **kubisch** (Cardano bei einer reellen Wurzel, trigonometrische Form `cos(arccos(…)/3 − 2πk/3)` bei dreien) → **`x^n=c`** → **Polynome in x²** (Substitution) → sonst numerisch (`realRootsNumeric`, Isolierung über Ableitungswurzeln).
- `roots.ts`: `scanRoots` (4000 Stützstellen, Bisektion; verwirft Pole/Sprünge über |f(r)|-Test; berührende Nullstellen über Goldenen Schnitt auf |f|), `scanExtrema` (Goldener Schnitt, Nachschärfen über Ableitung, verwirft Polartefakte), `findPoles` (Vorzeichenwechsel, Definitionsränder, |f|-Maxima; `isPole` verlangt wachsendes |f| bei 10⁻³,10⁻⁵,10⁻⁷), `endBehavior` (waagerecht/schräg, Extrapolation gegen 1/x-Reste), `recognize` (π-Vielfache zuerst, dann Brüche – **nur Vermutung**).
- `integrate.ts` (`integ` mit Tiefe ≤ 8): Konstanten herausziehen, Summen, Potenzregel (lineare Basis), Exponentialfunktionen, Tabelle für Funktionen mit linearem Argument, **Reduktionsformeln** `sin^n`, `cos^n`, `tan^n`, `sec^n`, `csc^n`, `ln^n`, **`sin^m·cos^n`** (Substitution bei ungerader Potenz, Doppelwinkel bei beiden geraden), `e^{ax}·sin/cos`, **partielle Integration** (Polynom × exp/trig/ln/arctan), **Partialbrüche** (rationale Nullstellen + ein irreduzibler/irrationaler quadratischer Faktor; arctan- bzw. ln-Formeln), **Wurzel aus Quadratischem** (`√(Av²+Bv+C)` und Kehrwert: arcsin/ln-Formeln), **u-Substitution** (Kandidaten: Funktionsknoten und -argumente, Potenzbasen/-exponenten; Tiefe ≤ 2). **Verifikation**: `antiderivative` gibt nur zurück, was nach Ableiten an ≥ 3 Stichproben (Parameter 1.37+0.73·i) mit dem Integranden übereinstimmt; sonst `null`. `definiteIntegral`: exakt nur, wenn F(b)−F(a) zur numerischen Kontrolle passt **und keine Polstelle im Intervall liegt** (`findPoles`) – uneigentliche Integrale bekommen nie einen Exaktwert (Hinweistext).
- `solve.ts`: `solveEquation(lhs, rhs, v, ctx, range)`: Parameter werden als Brüche eingesetzt (`bindParams`, dann „Näherung“-Hinweis), **rohe** Rationalform (Nullstellen des Nenners gehören nicht zur Lösung), exakt über `solvePolynomial`; sonst numerisch (`scanRoots` im Bereich) – numerisch gefundene Lösungen werden durch `exactRoot` (vermuteter Ausdruck exakt einsetzen, muss sich zu 0 vereinfachen) ggf. **bewiesen exakt**. `solveSystem(eqs, vars, ctx, range|ranges[])`: linear exakt (`solveLinearRat`), 2×2 nichtlinear per **`eliminate`** (eine Gleichung oder Summe/Differenz beider ist linear in einer Variablen → einsetzen → `solveEquation`; erkennt Widersprüche), sonst **Newton** aus Startgitter (n≤3, Bereich je Variable). Ergebnisarten `unique|solved|numeric|none|infinite|unsupported`.
- `limits.ts` (`exactLimit(body,v,to,dir)`): Reihenfolge: Einsetzen (Prüfung am **rohen** Ausdruck, weil `simplify` `0·(1/0)` zu 0 kürzt) → rationale Funktion bei ±∞ (Grade) → Quotient (0/0, ∞/∞ per **L'Hôpital**, Tiefe ≤ 6; Zähler endlich/Nenner ∞ → 0; Pole mit Vorzeichen) → 0·∞ (beide Umformungen) → `a^b = e^{b ln a}`. **Jedes Ergebnis wird mit `limitNumeric` verglichen** (Toleranz 1e-3, bei ∞ exakt gleich); sonst `null` (Knoten bleibt, numerisch auswertbar). Nicht existierende Grenzwerte bleiben NaN.

### 3.6 Analyse (`analysis/function.ts`)
- `analyzeFunction(expr, v, params, range)`: Parameter werden eingesetzt (`bindParams`; dann alle Ergebnisse `exact=false` + Hinweis). Numerische Suche am **ungekürzten** Ausdruck. **Pfad „rational“** (wenn `rationalForm(raw) ?? rationalForm(simplified)`): exakte Nullstellen (Nenner-Nullstellen ausgeschlossen), senkrechte Asymptoten und **Definitionslücken** (Vielfachheitsvergleich Zähler/Nenner; Lückenwert numerisch + exakt bei rationaler Stelle), Extrema über N₁ = P'Q−PQ' (Vorzeichenwechsel bei ungerader Vielfachheit; Typ aus Vorzeichen links/rechts), Wendepunkte über N₂ = N₁'Q−2N₁Q', Asymptoten aus Graden (**Polynome haben keine**), y-Achsenabschnitt, exakte Funktionswerte (`exactAt` mit Nennerrationalisierung für `a+b√d`). **Pfad „numerisch“**: `scanRoots/scanExtrema/findPoles/endBehavior`; Stellen werden über `exactRoot` (Nullstelle von f bzw. f' bzw. f'') zu exakten Ausdrücken, wenn beweisbar (z. B. `(π/2, 1)`, `(−1, −1/e)`), sonst `xGuess` (Vermutung, nur Anzeige).
- `Pt{x,y,xExpr,yExpr,xGuess,exact}`; Kennzeichnung „exakt“ vs. „Näherung“ im UI durchgängig.
- `tangentNormal` (exakt bei exakter Stelle; senkrechte Tangente erkannt), `integralOf`, `areaBetween` (Schnittstellen via `solveEquation`, Betragsflächen pro Teilintervall; exakt nur wenn alle Schnittstellen exakt), `intersections` (explizit), `intersectCurves` (über `solveSystem`).
- `format.ts: entriesOf` erzeugt Einträge mit `latex`, `exact`, `line` (Text für neue Zeile: Punkt als Tupel, Asymptote `x=…`/`y=…`).

### 3.7 Graph
- `viewport.ts`: `View{cx,cy,sx,sy,width,height,xScale,yScale}` im **Achsenraum** (bei log-Achsen log10); `zoomAt` hält den Weltpunkt unter dem Cursor fest; Zoom-Grenzen linear 1e-9…1e9, log 2…20000 px/Dekade. `linearTicks` (1-2-5-Schritte, Nebenlinien ab 8 px), `logTicks` (Dekaden, Nebenlinien 2…9 ab 120 px/Dekade), `formatTick`.
- `sampler.ts` (`samplePolylines`): Pixelraum; Startschritt 2 px, rekursive Halbierung bis Tiefe 10, Abweichung von der Sehne > 0,25 px verfeinert, Sprungschwelle 4 px am Maximaltiefen-Blatt trennt Linien, Definitionsränder per Bisektion, Budget `min(30000, max(2000, 30·Breite))`; einzelne Punkte werden verworfen; Werte auf ±10⁶ geklemmt. `sampleParametric`: gleiche Idee mit Abstand zur Sehne, Start 300 Intervalle, Tiefe 12, Budget 60 000.
- `implicit.ts`: Raster 4 px, Marching Squares inkl. Sattelauflösung; **Polstellenfilter**: Kante nur gültig, wenn F an 3 Zwischenpunkten (¼,½,¾) annähernd monoton ist; Segmente werden über Kantenschlüssel zu Polylinien verkettet (für gestrichelte Ränder). `fillRects`: Zellen mit ≥ 2 wahren Ecken gefüllt (Zeilenläufe).
- `items.ts`: `PlotItem{id,line,color,kind,probe?,analysis?,curve?,draw(view)}`; `Shape` ∈ `lines{dashed}`, `fillPoly`, `fillRects`, `points{glyph}`. `analysis` (Ausdruck, Variable, Parameter) nur bei expliziten Funktionen; `curve{F,params}` (F(x,y)=0) bei expliziten und impliziten.
- `model.ts` (`buildModel`): Pass 1 sammelt Namen von `f(x)=…`; Pass 2 parst mit Funktionsnamen; **Ableitungsdefinitionen** `f'`, `f''` werden aus den Definitionen erzeugt (Schleife, bis nichts Neues); Parameterzeilen `a=2` in Textreihenfolge (Zeilen überschreiben Slider); Klassifikation je Zeile: `def` mit 1 Parameter → explizit; `y=…`/Ausdruck in x → explizit; `r=…` (nur θ) → polar (Standard θ∈[0,12π]); Tupel mit t → parametrisch (Standard t∈[−10,10]), konstantes Tupel → Punkt; `=` sonst → implizit (`reduceEven` ersetzt `u^(2k)` durch `u`, damit `(x−y)²=0` sichtbar wird); `<,>,≤,≥` (auch Ketten) → Ungleichung (`y<g(x)` über exakte Fläche, sonst Raster); `\left\{…\right\}` → Bedingung/Bereich (`extractRange`); fehlende Parameter → Zeile `pending` mit `missing[]`. Farben `PALETTE[zeilenindex % 6]`.
- `sliders.ts`: `stepSlider(s, dt)`: Rate = (max−min)/4 · speed pro Sekunde; Modi `forward` (Umlauf), `backward`, `pingpong`.
- `draw.ts`: Raster (Haupt/Neben), Achsen (Beschriftung bleibt am Rand, wenn die Achse außerhalb liegt), Füllungen zuerst (Alpha 0,22), dann Linien (gestrichelt `[8,6]`), dann Punkte (Glyphen circle/ring/up/down/diamond/square).

### 3.8 UI-Verhalten (ungeprüft im echten Fenster)
- `GraphView`: Ziehen verschiebt, Mausrad zoomt am Cursor (Shift: nur x, Alt: nur y), Doppelklick = Reset, Tasten (Graph fokussiert) `+ − ←↑↓→ 0 1`; Klick ohne Ziehen (< 4 px) ruft `onPick`; meldet verzögert (150 ms) den sichtbaren Bereich (`onRange`); Hover zeigt `f(x)` und rastet an Kurven (< 14 px) und Markern (< 12 px) ein.
- `GraphWorkspace`: Analyse für die gewählte explizite Funktion; zweite Kurve (explizit oder implizit) für Schnittpunkte; Fläche/Integral nur mit expliziten Funktionen; jedes Ergebnis hat „→ Zeile“.
- `CalcView`/`SolveSections`: mehrere Gleichungszeilen = System; eine Gleichung mit genau einer Unbekannten = Lösen; Ausdruck mit einer Variablen = Stammfunktion.

---

## 4. Aktueller Stand gegenüber dem Auftrag

| Auftragspunkt | Stand |
|---|---|
| 2 LaTeX-Parser/AST, KaTeX überall, Fehlermeldungen | ✅ Parser/AST/Drucker fertig. ⚠️ **Eingabe ist eine einfache `<textarea>`** mit Vorschau und Fehlertext; **kein WYSIWYG-Mathe-Editor, keine Autovervollständigung, keine Syntaxfärbung** |
| 3 Graphen (explizit, implizit, parametrisch, polar, stückweise, Ungleichungen, mehrere) | ✅ |
| 4 interaktiver Graph (Zoom am Cursor, log-Achsen, Raster, Hover, Unstetigkeiten, adaptives Abtasten) | ✅ (UI ungeprüft im Fenster) |
| 5 Analyse (Nullstellen, Schnittpunkte, Extrema, Wendepunkte, Asymptoten, Ableitung, Integral, Stammfunktion, Tangente/Normale, Fläche, Gleichungen/Systeme) | ✅ mit Grenzen (Abschnitt 6); exakt und numerisch klar gekennzeichnet |
| 6 Slider/Parameter | ✅ automatisches Erkennen, Bereich/Schritt, Animation (mehrere gleichzeitig) |
| 7 Geometrie-Arbeitsbereich | ❌ **nicht begonnen** |
| 8 Komplexe Zahlen, Vektoren, Folgen, Matrizen | ❌ nicht begonnen (Matrizen werden nur geparst/gedruckt; `i` unbekannt) |
| 9 Ausdruckspanel (Ordner, Umordnen, Ausblenden, Farben wählen, Notizen, Duplizieren, Referenzen, Umschalten gerendert/Quelltext) | ⚠️ nur: Zeilenliste mit Vorschau, feste Farben nach Zeilennummer, Referenzen über `f(x)=…`/`a=2`. **Fehlt**: Ordner, Umordnen, Ausblenden, Farbwahl, Notizen, Duplizieren, Quelltext/Gerendert-Umschalter |
| 10 Speichern/Export (Projekte, Autosave, JSON, PNG/SVG, LaTeX, Drucken) | ❌ **nichts persistiert** – beim Neustart ist alles weg |
| 11 Design (Hell/Dunkel, Undo/Redo, Kontextmenüs, anpassbares Layout) | ⚠️ Hell/Dunkel nur per System-Einstellung (kein Umschalter); **kein Undo/Redo**, keine Kontextmenüs, kein Layout-Anpassen; Tastenkürzel nur im Graphen |
| 12/13 Windows-Paket | ✅ per GitHub Actions (NSIS, MSI, portable `.exe`, WebView2 offline). ⚠️ nur für das erste Gerüst bestätigt (Abschnitt 0) |
| Dokumente: README, Tastenkürzel-Dokumentation, Build-Anleitung | ⚠️ README aktuell, **eigene Tastenkürzel-Datei fehlt** |

---

## 5. Änderungen der letzten Sitzung („Fehler beheben, Grenzen verbessern“)

**Fehler (per Zufallstests gefunden und behoben)**
1. Drucker (`latex.ts`): falsche Vorzeichen/fehlende Klammern bei nicht vereinfachten ASTs (`x-(y+z)`, `x-(-x)`, `-(a+b)`) → `termSign`, `flipNeg`, `flattenMul`, `isSumLike`, `paren` bei negativen Einzelsummen.
2. `simplify.ts`: `sAdd` verteilt `Zahl·(Summe)` innerhalb von Summen (`x-(x+1)=-1`); Sortierung bei gleichem Grad nach Term ohne Koeffizient; `e^{…}`-Faktoren hinter die Variablen (`x·e^x`).
3. Grenzwert-Einsetzung: Prüfung am rohen Ausdruck (0·∞ wurde zu 0 gekürzt).
4. Analyse/Löser: Nenner bleiben erhalten (`x²/x=0` hat keine Lösung, `x²/x` hat eine Lücke bei 0); Analyse sucht numerisch am **ungekürzten** Ausdruck.
5. Uneigentliche Integrale (`∫₋₁¹ 1/x`) wurden als exakt ausgegeben → Polstellenprüfung in `definiteIntegral`.
6. Polynome haben keine „Asymptoten“ mehr; Definitionen, die andere Definitionen aufrufen (`g(x)=f(x)+1`), wurden vorher ohne Funktionsnamen geparst.

**Neue/verbesserte Fähigkeiten**: Integration (siehe 3.5), exakte Wurzeln für Kubiken/`x^n=c`/Polynome in x², exakte 2×2-Systeme per Elimination und Widerspruchserkennung, Newton mit Bereich je Variable, `intersectCurves` + Auswahl impliziter Kurven im Panel (`PlotItem.curve`), Ableitungsstriche `f'(x)`, `f''(x)`, **exakte Grenzwerte** (`limits.ts`) und bessere numerische Divergenzerkennung, `reduceEven` für implizite Kurven, einstellbarer Suchbereich im Rechner (`computeSections(src, range)`), `expand(e, intoFunctions)`.

**Tests**: von 36 auf 58; Zufallstest (fest gesät) in `improve.test.ts`. Die ungesäten Fuzz-Skripte (Parser mit 30 000 Zufallsstrings, Zeichnen von ~350 Zufallskurven, Ausdrucksgenerator mit Ableitungsvergleich) lagen nur in `/tmp` und sind **nicht im Repo** (siehe Schritt 6).

**Frühere Sitzungen (Kurzfassung)**: Gerüst (Tauri+React+KaTeX, Actions-Workflow) → Engine (Parser, AST, Vereinfachen, Ableiten, Auswerten, Drucker) → Graph (Viewport, adaptives Abtasten, Raster, log-Achsen, Hover) → Slider und Kurventypen (implizit, parametrisch, polar, Ungleichungen, Definitionsbereiche) → Analyse (Panel, Integration, Löser, Tangente, Fläche).

---

## 6. Bekannte Probleme und Grenzen

1. **Oberfläche ungeprüft**: React-Komponenten wurden nur mit Ersatz-Typen geprüft. Mit den echten `@types/react` können Typfehler auftreten (Handler sind bewusst mit strukturellen Typen wie `(e: { target: { value: string } })` geschrieben, um das zu vermeiden). Laufzeitverhalten von Pointer-/Wheel-Events, `ResizeObserver`, DPR-Skalierung, Panel-Layout und Slider-Animation ist nie gesehen worden.
2. **Leistung der Slider-Animation**: Jeder Frame ruft `buildModel` (parst alle Zeilen neu) und zeichnet neu; die Analyse läuft bei jedem Parameterwert erneut (numerisch ~4000 Auswertungen je Suche). Bei vielen Zeilen/impliziten Kurven vermutlich zu langsam → Parse-Cache und Throttling einplanen.
3. **Integration**: keine Stammfunktion für z. B. `e^{x²}`, `sin(x)/x`, `√(sin x)`, `1/ln x`, `sin(x)·cos(2x)` (verschiedene Argumente), `sinh^n/cosh^n`, `x^n·arcsin x`, Partialbrüche mit mehrfachen irreduziblen Faktoren, Trigonometrische Substitution für allgemeine Wurzeln.
4. **Nullstellen**: ab Grad 5 (und Quartiken ohne x²-Struktur) nur numerisch; numerische Suche nutzt 4000 Stützstellen im **sichtbaren Bereich** (schmale Nullstellenpaare/Pole können übersehen werden); `recognize` ist nur eine Vermutung und wird nur bei exaktem Beweis als „exakt“ gezeigt.
5. **Grenzwerte**: exakt nur für die Muster aus 3.5; einseitige Grenzwerte mit Betrag/Vorzeichen (`|x|/x`) bleiben numerisch; `sin x` bei ∞ existiert nicht (bleibt NaN). Grenzwert-Knoten werden im Graphen nicht gezeichnet (nur Rechner/numerisch).
6. **Systeme**: Newton aus Gitter kann Lösungen verfehlen; nichtlinear nur n Gleichungen für n≤3 Unbekannte; exakt nur 2×2 mit Eliminierbarkeit (z. B. nicht Kreis ∩ Hyperbel).
7. **Implizit**: Raster 4 px (dünne Strukturen/Singularitäten können fehlen), isolierte Punkte (`x²+y²=0`) und Doppelwurzeln in Differenzen (`(x−y)²−0.0=0` wird gelöst, aber `(x²+y²)²=0` nicht) fehlen; Ränder von Ungleichungsketten werden nicht gezeichnet; Hover-Einrasten nur bei expliziten Kurven.
8. **Analyse nur für explizite Funktionen** `y=f(x)`; parametrische/polare/implizite Kurven werden nicht analysiert (nur Schnittpunkte implizit/explizit). Fläche/Integral nur explizit.
9. ~~README veraltet~~ – am Ende der Sitzung korrigiert (Engine-Tabelle vollständig, Abschnitt „Noch nicht enthalten“ aktuell).
10. **Domänenerweiterung** durch `simplify` (siehe 3.3) kann bei Rechner-Ausgaben Definitionsbereiche erweitern (`(√x)²→x`).
11. **Parser-Lücken**: siehe 3.2 (`\vec`, komplexes `i`, Listen, `\mathrm{d}`); Vektoren/Matrizen/Tupel höherer Dimension werden nicht berechnet bzw. gezeichnet; Matrizen nur geparst und gesetzt.
12. **Keine Persistenz, kein Undo/Redo, kein Editor** (Abschnitt 4).
13. **Tauri-Seite leer**: keine Rust-Befehle, kein Dateizugriff; `csp: null`; Bundle-Kennung `de.example.matheapp` ist ein Platzhalter. Nicht signierte `.exe` löst SmartScreen aus.
14. Ausgaben sind **deutsch hartkodiert** (kein i18n).

---

## 7. Designentscheidungen und Begründungen

| Entscheidung | Begründung |
|---|---|
| **Exakte rationale Zahlen (BigInt)** statt Floats im AST | Exakte Ergebnisse (`0.1+0.2=3/10`), klare Trennung exakt/Näherung; Floats entstehen nur in `compile`. |
| **Kein `eval`**, Closure-Baum | Vorgabe des Auftrags; schnell genug für den Graphen. |
| Engine **rein und UI-frei** | Vollständig mit `node` testbar, obwohl in der KI-Umgebung weder Browser noch Netz verfügbar sind. |
| **Jede „exakt“-Aussage wird bewiesen oder gegengeprüft**: Stammfunktion durch Ableiten, Nullstelle durch exaktes Einsetzen (`exactRoot`), Grenzwert gegen numerische Näherung, Integral gegen Numerik + Polstellenprüfung | Auftrag: Korrektheit vor Funktionsumfang; lieber „Näherung“ als falsches Exakt. |
| Analyse sucht am **ungekürzten** Ausdruck | `simplify` erweitert Definitionsbereiche. |
| Nenner bleiben in `rationalForm(…, false)` erhalten | `x²/x` ist bei 0 nicht definiert. |
| **Eine Zeile = ein Objekt**, Typ wird aus der Form erkannt (Desmos-Prinzip) | Einfaches Modell; `f(x)=…`, `a=2`, `y<…`, `r=…`, `(x(t),y(t))`. |
| Parameter über **`a=2`-Zeilen und Slider** (Zeilen gewinnen) | Beides wie in Desmos; Slider werden aus `UndefinedSymbolError`/`missing` angeboten. |
| Definitionsbereich als **`\left\{ … \right\}`** am Zeilenende | Desmos-Syntax; gleichzeitig Bereich für t/θ. |
| Polar-Standard 0…12π, parametrisch −10…10 | Sichtbare Standardkurven (Spirale, Parabeln); per Bereichsangabe überschreibbar. |
| **`\log` = Basis 10** | wie Desmos/Taschenrechner; `\ln` natürlich. |
| LaTeX-Treue (`x^23` = x²·3) | „Standard-LaTeX“ laut Auftrag; Fehlermeldung bei `^-1`. |
| Zeichnen in **Pixelkoordinaten** über `PlotItem.draw(view)` | Zoom/Pan ohne Zustand im Objekt; log-Achsen einheitlich. |
| Analyse-Ergebnisse als **bearbeitbare Zeilen** („→ Zeile“) | Auftrag: Analyseergebnisse als eigenständig editierbare Ausdrücke; deshalb muss `toLatex` wieder einlesbar sein. |
| Tests **vor** dem Build im Workflow | Fehlerhafte Mathematik erzeugt keine `.exe`. |
| Node 22 + `--experimental-strip-types` | Keine Test-/Transpiler-Abhängigkeit installierbar (kein Netz). **Folge**: nur „löschbare“ TypeScript-Syntax in `src/engine|analysis|graph` – **keine `enum`, `namespace`, Konstruktor-Parameter-Properties**; Importe mit Endung `.ts`; Typen mit `import type`. |
| GitHub Actions statt lokalem Build | Kein Windows/Netz in der KI-Umgebung, Nutzer ohne Claude Code. |
| Hell/Dunkel nur per `prefers-color-scheme` | Schnellste Lösung; Umschalter steht noch aus. |

---

## 8. Entwicklungsanleitung

### 8.1 Lokal (nur wenn Node 22, Rust, VS-Build-Tools installiert)
```
npm install
npm run tauri icon app-icon.png     # einmalig, erzeugt src-tauri/icons
npm test                            # 58 Tests (Node >= 22.6)
npm run tauri dev                   # Entwicklung
npm run tauri build                 # Installer + exe in src-tauri/target/release
```

### 8.2 Windows-.exe ohne lokale Umgebung (der Weg des Nutzers)
Dateien entpacken → GitHub Desktop (Add local repository, Commit, Push, Branch `main`) → GitHub → Reiter **Actions** → Lauf „Windows-Build“ → unten **Artifacts**. Bei rotem Lauf den fehlgeschlagenen Schritt kopieren und der KI geben. Der Workflow führt `npm test` vor dem Build aus.

### 8.3 In der KI-Umgebung (ohne Netz) prüfen
```
# Tests (alle oder eine Datei)
node --experimental-strip-types --test "tests/*.test.ts"
node --experimental-strip-types --test tests/improve.test.ts

# Typcheck Engine/Analyse/Graph ohne React:
tsc --ignoreConfig --noEmit --strict --target ES2020 --lib ES2020,DOM --module esnext \
    --moduleResolution bundler --allowImportingTsExtensions src/engine/*.ts src/analysis/*.ts src/graph/*.ts

# Typcheck inkl. React-Komponenten mit Ersatz-Typen (Datei /tmp/stubs.d.ts anlegen):
tsc --ignoreConfig --noEmit --strict --jsx react-jsx --target ES2020 --lib ES2020,DOM,DOM.Iterable \
    --module esnext --moduleResolution bundler --allowImportingTsExtensions --skipLibCheck --isolatedModules \
    /tmp/stubs.d.ts src/*.tsx src/engine/*.ts src/graph/*.ts src/analysis/*.ts
```
Inhalt von `/tmp/stubs.d.ts` (muss bei neuen Hooks erweitert werden):
```ts
declare module "react" {
  export function useMemo<T>(f: () => T, d: unknown[]): T;
  export function useState<T>(i: T | (() => T)): [T, (v: T | ((p: T) => T)) => void];
  export function useRef<T>(i: T): { current: T };
  export function useEffect(f: () => void | (() => void), d?: unknown[]): void;
  const React: any; export default React;
}
declare module "react/jsx-runtime" { export const jsx: any; export const jsxs: any; export const Fragment: any; }
declare module "react-dom/client" { const x: any; export default x; }
declare module "katex" { const k: { renderToString(s: string, o?: object): string }; export default k; }
declare namespace JSX { interface IntrinsicElements { [k: string]: any } interface IntrinsicAttributes { key?: any } }
declare module "*.css";
```
Hinweise: `tsc` meldet „tsconfig.json is present …“, wenn Dateien übergeben werden → `--ignoreConfig` verwenden. Auslieferung: `cd /home/claude && python3 -c "import shutil; shutil.make_archive('/mnt/user-data/outputs/mathe-app','zip','/home/claude','mathe-app')"` und `present_files`. Python-Skripte zum Patchen: Backslashes in Testdateien nur mit **Raw-Strings** (`r'''…'''`) schreiben, sonst werden sie verdoppelt.

### 8.4 Konventionen
Neue Logik zuerst als reines Modul + Test; „exakt“ nur mit Beweis; UI-Texte Deutsch; keine `enum`/Parameter-Properties in Engine-Code; `toLatex`-Ausgaben müssen parsebar bleiben; nach jeder Änderung Tests + Typcheck; README und diese Datei aktuell halten.

---

## 9. Nächste Schritte (Priorität)

0. **Build bestätigen lassen**: Den Nutzer bitten, die neueste Zip in GitHub zu pushen und das Ergebnis von **Actions** zu melden (zuletzt bestätigt: nur das erste Gerüst). Erwartbare Fehlerquellen: Typfehler gegen echte `@types/react`, `vite build`-Fehler, Tauri-Konfiguration (Icons werden im Workflow erzeugt). Fehler sofort beheben. Danach, falls möglich, Rückmeldung zu Zoom/Ziehen/Slider/Analysepanel im echten Fenster einholen (Leistung der Animation, Layout).
1. **Geometrie-Arbeitsbereich** (Auftrag Punkt 8). Vorschlag: neues Verzeichnis `src/geometry/` (reine Logik, mit Tests) + Reiter „Geometrie“. Kern: **Konstruktions-DAG**: freie Punkte (verschiebbar) und abhängige Objekte; Neuberechnung in topologischer Reihenfolge, damit Konstruktionen beim Verschieben konsistent bleiben. Objekte: Punkt, Gerade, Strecke, Strahl, Kreis (Mittelpunkt+Punkt / Radius), Bogen, Polygon, Vektor, Winkel, Mittelpunkt, Schnittpunkte (Gerade/Kreis-Kombinationen, mehrfach → Index), Senkrechte, Parallele, Mittelsenkrechte, Winkelhalbierende; Messungen (Abstand, Winkel, Fläche, Umfang) mit **LaTeX-Ausgabe**. Wiederverwendung: `graph/viewport.ts` (Koordinatensystem), `graph/draw.ts`/`items.ts` (`Shape`), Hover/Pick-Mechanik aus `GraphView`. Exakte Werte, wo möglich (Abstände als `√…` über `simplify`). Tests: Verschieben eines Basispunkts ändert abhängige Punkte korrekt (Invarianten wie „Mittelsenkrechte bleibt senkrecht zur Strecke“).
2. **Persistenz und Projekte** (Auftrag Punkt 10): JSON-Format `{version, src (Original-LaTeX), sliders, view, settings}`; Autosave (zunächst `localStorage`, später Tauri-Dateisystem/SQLite), Projektliste (duplizieren/löschen), Import/Export JSON, Export PNG/SVG des Graphen (SVG aus `Shape`s erzeugen, PNG über `canvas.toBlob`), Export der Zeilen als LaTeX, Kopieren von Ergebnissen, Drucken.
3. **Ausdruckspanel** (Auftrag Punkt 9) und **Editor** (Punkt 1): Zeilen als eigene Objekte mit ID (statt eines Textareas): Hinzufügen/Löschen/Umordnen (Drag), Ordner, Ein-/Ausblenden, Farbwahl, Notizen, Duplizieren, Umschalter „gerendert/LaTeX-Quelltext“, **Undo/Redo**. Für den WYSIWYG-Mathe-Editor mit Autovervollständigung/Syntaxfärbung ist eine Entscheidung nötig (offline bündelbare Bibliothek wie MathLive vs. eigener Editor auf Basis von `ParseError`-Positionen). `buildModel` dann auf Zeilen-Objekte umstellen und **Parse-Cache** einführen (löst zugleich Problem 2).
4. **Zusatztools** (Auftrag Punkt 9 der Tools): komplexe Zahlen (`i`, Ebene, Arithmetik, Transformationen; AST/Evaluator brauchen einen komplexen Pfad), Vektoren (`\vec`, Summe, Skalar-/Kreuzprodukt, Zerlegung), Folgen (explizit, rekursiv, arithmetisch/geometrisch, Konvergenzdarstellung), Matrizen (Rechnen, Determinante, Inverse, Eigenwerte – `matrix`-Knoten und Parser existieren schon).
5. **UI-Feinschliff**: Hell/Dunkel-Umschalter, Tastenkürzel (Strg+Z/Y, Strg+S …) plus eigene Dokumentation `SHORTCUTS.md`, Kontextmenüs, anpassbares Layout, Panelbreiten.
6. **Qualitätssicherung**: Fuzz-Tests ins Repo (`tests/fuzz.test.ts`: Parser mit Zufallsstrings, Ausdrucksgenerator mit Druck-/Vereinfachungs-/Ableitungsvergleich, Zufallskurven zeichnen); README bei jedem Schritt pflegen; Bundle-Identifier und Fenstertitel festlegen; ggf. Code-Signierung.
7. **Mathematische Lücken** (je nach Bedarf, siehe Abschnitt 6): Analyse für parametrische/polare/implizite Kurven; Stammfunktionen für Produkte verschiedener Winkel und hyperbolische Potenzen; Quartiken durch Faktorisierung über ℚ in Quadratiken; exakte Schnittpunkte für weitere Systeme (Resultanten); isolierte Punkte bei impliziten Kurven; Grenzwerte als Graph-Objekte.

**Erste Handlung in der neuen Konversation**: Projektdateien einlesen, `npm test` (58 grün) und Typcheck ausführen, dann Schritt 0 mit dem Nutzer klären und ohne Rückfrage mit Schritt 1 (Geometrie) beginnen, sobald der Build bestätigt ist.
