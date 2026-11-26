# Mathe App (Tauri 2 + React + TypeScript)

Stand: Build-Gerüst. Es enthält eine LaTeX-Eingabe mit KaTeX-Rendering (offline) und die komplette Build-Pipeline für Windows.
Parser, AST, Rechenengine, Graph und Geometrie sind eigene Module.

## Windows-.exe ohne lokale Entwicklungsumgebung bauen (GitHub Actions)

1. Auf github.com einen kostenlosen Account anlegen und anmelden.
2. Oben rechts auf "+" → "New repository" klicken. Namen vergeben (z. B. `mathe-app`), "Private" oder "Public" wählen, **ohne** README anlegen, "Create repository".
3. Entpackten Projektordner hochladen:
   - Auf der leeren Repository-Seite "uploading an existing file" wählen.
   - **Den Inhalt** des Ordners `mathe-app` (nicht den Ordner selbst) ins Fenster ziehen, sodass `package.json`, `src`, `src-tauri` usw. im Hauptverzeichnis liegen.
   - Versteckte Ordner wie `.github` werden beim Ziehen manchmal nicht mitgenommen. Prüfe nach dem Hochladen, ob `.github/workflows/build-windows.yml` im Repository liegt. Falls nicht: "Add file" → "Create new file", als Namen `.github/workflows/build-windows.yml` eingeben und den Inhalt der Datei einfügen.
   - Unten "Commit changes" klicken (Branch `main`).
4. Oben auf den Reiter **Actions** wechseln. Der Build "Windows-Build" startet automatisch (oder über "Run workflow"). Der erste Lauf dauert etwa 10–20 Minuten.
5. Ist der Lauf grün, den Lauf anklicken und unten bei **Artifacts** herunterladen:
   - `installer-nsis`: Installer (.exe)
   - `installer-msi`: MSI-Installer
   - `portable-exe`: portable `mathe-app.exe`
6. Schlägt der Lauf fehl (rotes Kreuz): auf den Schritt klicken, der rot ist, und die Fehlermeldung kopieren.

Hinweise:
- Die Datei ist nicht signiert. Windows SmartScreen zeigt deshalb evtl. "Der Computer wurde durch Windows geschützt": "Weitere Informationen" → "Trotzdem ausführen".
- Der Installer bringt WebView2 für die Offline-Installation mit und ist dadurch größer.
- Die portable `.exe` benötigt WebView2 auf dem Rechner (bei Windows 11 und aktuellem Windows 10 meist vorhanden).

## Lokal bauen (optional)

Voraussetzungen: Node.js 20+, Rust (stable), Visual Studio Build Tools mit C++-Workload.

    npm install
    npm run tauri icon app-icon.png
    npm run tauri dev      # Entwicklung
    npm run tauri build    # Installer + exe in src-tauri/target/release

## Mathe-Engine (`src/engine`)

Getrennt von der Oberfläche, ohne UI-Abhängigkeiten, ohne `eval`:

| Datei | Aufgabe |
|---|---|
| `lexer.ts`, `parser.ts` | LaTeX → AST (rekursiver Abstieg), Fehler mit Position und „unvollständig"-Flag |
| `ast.ts` | AST-Typen, exakte Zahlen (BigInt-Brüche), Substitution, freie Symbole |
| `simplify.ts` | exakte Vereinfachung (Brüche, Wurzeln, π-Werte, Summen, `expand`) |
| `diff.ts` | symbolische Ableitung (Ketten-, Produkt-, Potenzregel, Hauptsatz) |
| `eval.ts` | numerische Auswertung (Closure-Baum), Integration (Gauß–Kronrod), Grenzwerte |
| `latex.ts` | AST → LaTeX für die Anzeige (muss wieder einlesbar sein) |
| `poly.ts` | exakte Polynome über ℚ, rationale Funktionen, Nullstellen (rational, quadratisch, kubisch, `x^n=c`, Polynome in `x²`) |
| `roots.ts` | numerische Suche: Nullstellen, Extrema, Pole, Verhalten im Unendlichen |
| `integrate.ts` | Stammfunktionen (durch Ableiten gegengeprüft), bestimmte Integrale |
| `solve.ts` | Gleichungen und Gleichungssysteme (exakt oder numerisch) |
| `limits.ts` | exakte Grenzwerte (Einsetzen, L'Hôpital, Grade, Pole) |

Tests: `npm test` (laufen auch vor jedem Windows-Build; schlägt ein Test fehl, wird nicht gebaut).

### Eingabekonventionen
- Standard-LaTeX: `x^23` bedeutet wie in LaTeX `x²·3`; für Mehrstelliges `x^{23}` schreiben.
- `\log` ist der Zehnerlogarithmus, `\ln` der natürliche; `\log_{b}` für andere Basen.
- `\sin 2x` = sin(2x); `\sin x \cos x` = sin(x)·cos(x); `\sin^{-1}` = arcsin.
- `f(x)=…` ist immer eine Funktionsdefinition. Ein Aufruf `f(3)` wird nur erkannt, wenn `f` als Funktion bekannt ist (`parse(src, {functions:["f"]})`).
- Im Integral beendet `d` + Variable den Integranden (`\int_0^1 x^2\,dx`).
- `e`, `\pi`, `\tau`, `\infty` sind Konstanten.

## Geometrie (`src/geometry`, `GeometryView.tsx`)
Reiter „Geometrie“: dynamische Konstruktionen wie in GeoGebra. Freie Punkte lassen sich mit „Bewegen“ ziehen; alle davon abhängigen Objekte folgen.

- **Zeichnen**: Punkt, Gerade, Strecke, Strahl, Vektor, Kreis (Mittelpunkt + Punkt oder Radius), Bogen, Polygon.
- **Konstruieren**: Mittelpunkt, Schnittpunkt (Gerade/Strecke/Strahl/Kreis/Bogen, mehrfach → Index), Senkrechte, Parallele, Mittelsenkrechte, Winkelhalbierende.
- **Messen**: Abstand, Winkel, Fläche, Umfang – mit LaTeX-Ausgabe und, wo beweisbar, **exaktem Wert** (z. B. `2\sqrt{2}`, `8\pi`, `90^\circ`); sonst `\approx`.
- Klick auf leere Fläche legt Punkte an (Raster-Fang erzeugt exakte Koordinaten). Strg+Z / Strg+Y, Entf löscht (samt abhängigen Objekten), Esc bricht ab.
- Objektliste rechts: Gleichungen und Koordinaten als LaTeX, Ein-/Ausblenden, Löschen.

### Noch nicht enthalten
Transformationen/Tangenten/Ortslinien in der Geometrie, komplexe Zahlen, Vektor- und Matrixrechnung (Matrizen werden geparst und gesetzt), Folgen, Speichern/Export von Projekten,
WYSIWYG-Formeleditor, Undo/Redo für Ausdrücke. Ausführlicher Stand und Planung: `HANDOVER.md`.

## Graph (`src/graph`, `GraphView.tsx`)

| Datei | Aufgabe |
|---|---|
| `viewport.ts` | Welt ↔ Pixel, Zoom am Cursor, Verschieben, lineare/logarithmische Achsen, Rasterschritte, Beschriftung |
| `sampler.ts` | adaptives Abtasten: erkennt Definitionslücken, Sprünge und Polstellen (keine Verbindungsstriche) |
| `model.ts` | Eingabetext → darstellbare Funktionen, Definitionen `f(x)=…`, Parameter `a=2`, Fehlermeldungen pro Zeile |
| `draw.ts` | Canvas-Zeichnung: Raster, Achsen, Kurven, Marker |

Bedienung: Ziehen verschiebt, Mausrad zoomt am Cursor (Shift: nur x, Alt: nur y), Doppelklick setzt zurück.
Tasten (Graph fokussiert): `+` `-` Zoom, Pfeile verschieben (Shift: weiter), `0` zurücksetzen, `1` Maßstab 1:1.
Wertebereich, Rasterabstand und log-Achsen stehen in der Werkzeugleiste. Fährt man nahe an eine Kurve, wird f(x) angezeigt.

Eingabe pro Zeile (alles in LaTeX):

| Schreibweise | Darstellung |
|---|---|
| `f(x)=…`, `y=…`, Ausdruck in x | Funktion (stückweise per `cases`) |
| `x^2+y^2=25`, `x=3`, `xy=1` | implizite Kurve (Marching Squares, Polstellen werden nicht überbrückt) |
| `r=1+\cos(\theta)` | Polarkurve (Standardbereich θ ∈ [0, 12π]) |
| `(\cos t,\sin t)` | parametrische Kurve (Standardbereich t ∈ [−10, 10]) |
| `(1,2)` | Punkt |
| `y<x^2`, `x^2+y^2\le 25`, `0<y<x` | Ungleichung mit schattiertem Bereich; `<`/`>` gestrichelter, `≤`/`≥` durchgezogener Rand |
| `… \left\{ 0\le t\le 2\pi \right\}` | Definitionsbereich/Bedingung (mehrere mit Komma = „und“), bei t und θ auch als Bereich |
| `a=2` | Parameter für andere Zeilen |

Fehlt ein Parameter (z. B. `a\sin(bx+c)`), erscheint „Slider anlegen“. Slider haben Bereich, Schrittweite und Animation
(vorwärts, rückwärts, hin und her; Geschwindigkeit wählbar; mehrere laufen gleichzeitig). Eine Zeile `a=2` überschreibt einen Slider `a`.

Noch nicht im Graphen: Ableitungsstriche (`f'`), Listen, 3D, Doppelwurzeln bei impliziten Kurven (z. B. `(x-y)^2=0`, kein Vorzeichenwechsel),
Schnittpunkte/Nullstellen/Extrema als Markierungen.

## Analyse (`src/analysis`, `GraphWorkspace.tsx`, Reiter „Analyse“ neben dem Graphen)

| Funktion | Verfahren |
|---|---|
| Nullstellen, Extrema, Wendepunkte, Asymptoten, Lücken, y-Achsenabschnitt | **rationale Funktionen exakt** (Polynomzerlegung, rationale Nullstellen, Wurzelausdrücke für Quadratisches); sonst numerisch |
| numerisch gefundene Stellen | werden zu exakten Ausdrücken, wenn sich das durch exaktes Einsetzen **beweisen** lässt (z. B. `π/2`, `−1/e`) |
| Schnittpunkte zweier Kurven | exakt für Polynome/rationale Funktionen, sonst numerisch |
| Tangente und Normale | exakt, Stelle als LaTeX eingeben (`\frac{\pi}{4}`) oder im Graph anklicken |
| Stammfunktion | Regeltabelle, Substitution, partielle Integration, Partialbrüche; **jede Stammfunktion wird durch Ableiten gegengeprüft** |
| Integral, Fläche zwischen Kurven | exakt über die Stammfunktion, getrennt an den Schnittstellen; schattiert im Graph |
| Gleichungen und Systeme (Reiter „Rechner“) | Polynome und rationale Funktionen exakt, lineare Systeme exakt, nichtlineare numerisch (Newton) |

Jedes Ergebnis trägt die Kennzeichnung **exakt** oder **Näherung**. Uneigentliche Integrale (Polstelle im Intervall) werden nie als exakter Wert ausgegeben.
Die Knöpfe „→ Zeile“ übernehmen ein Ergebnis (Punkt, Asymptote, Tangente, f′, F, Fläche als `A=…`) als neue, frei editierbare Zeile.

Weitere Fähigkeiten: Ableitungsstriche `f'(x)`, `f''(x)` für definierte Funktionen; exakte Grenzwerte (`\lim`, Einsetzen, L'Hôpital, Grad bei ±∞, Pole mit Vorzeichen;
jedes exakte Ergebnis wird numerisch gegengeprüft); kubische Gleichungen (Cardano/trigonometrisch), `x^n=c` und Polynome in `x²` exakt;
2×2-Systeme per Elimination exakt (Kreis∩Gerade, Kreis∩Kreis, Parabel∩Gerade); Schnittpunkte beliebiger Kurven (explizit/implizit) im Graph;
implizite Kurven mit gerader Vielfachheit wie `(x-y)^2=0`; einstellbarer Suchbereich im Rechner.

Grenzen: Stammfunktionen nur, wenn eine geschlossene Form gefunden wird (nicht z. B. `e^{x^2}`, `\sin(x)/x`, `\sqrt{\sin x}`);
Gleichungen ab Grad 5 sowie Quartiken ohne Substitution nur numerisch; numerische Suche nur im sichtbaren Bereich bzw. im eingestellten Rechner-Bereich;
Analyse nur für explizite Funktionen (Schnittpunkte auch implizit); parametrische/Polarkurven werden nicht analysiert; Punkte wie `x^2+y^2=0` (isolierter Punkt) erscheinen nicht.
