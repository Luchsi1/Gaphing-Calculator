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
