# Mathe App (Tauri 2 + React + TypeScript)

Stand: Build-Gerüst. Es enthält eine LaTeX-Eingabe mit KaTeX-Rendering (offline) und die komplette Build-Pipeline für Windows.
Parser, AST, Rechenengine, Graph und Geometrie folgen als eigene Module.

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
| `latex.ts` | AST → LaTeX für die Anzeige |

Tests: `npm test` (laufen auch vor jedem Windows-Build; schlägt ein Test fehl, wird nicht gebaut).

### Eingabekonventionen
- Standard-LaTeX: `x^23` bedeutet wie in LaTeX `x²·3`; für Mehrstelliges `x^{23}` schreiben.
- `\log` ist der Zehnerlogarithmus, `\ln` der natürliche; `\log_{b}` für andere Basen.
- `\sin 2x` = sin(2x); `\sin x \cos x` = sin(x)·cos(x); `\sin^{-1}` = arcsin.
- `f(x)=…` ist immer eine Funktionsdefinition. Ein Aufruf `f(3)` wird nur erkannt, wenn `f` als Funktion bekannt ist (`parse(src, {functions:["f"]})`).
- Im Integral beendet `d` + Variable den Integranden (`\int_0^1 x^2\,dx`).
- `e`, `\pi`, `\tau`, `\infty` sind Konstanten.

### Noch nicht enthalten (folgt in späteren Schritten)
Stammfunktionen und symbolische Grenzwerte/Summenformeln, Gleichungslöser, Matrizen- und Vektorrechnung (Matrizen werden bereits geparst und gesetzt), komplexe Zahlen, Ableitungsstrich `f'`, Graph-Renderer, Slider, Geometrie.

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

Eingabe pro Zeile: `f(x)=…` (definiert und zeichnet f), `y=…`, ein Ausdruck in x, oder `a=2` (Parameter für andere Zeilen).
Noch nicht im Graphen: implizite Kurven, Parametrisch, Polar, Ungleichungen, Slider.
