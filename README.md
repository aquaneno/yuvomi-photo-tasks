# Foto-Aufgaben für Yuvomi

Fotografiere einen Aufgabenzettel oder wähle ein vorhandenes Bild. Die Texterkennung liest gedruckten deutschen und englischen Text direkt auf deinem Gerät. Du kannst den Text korrigieren und daraus eine Aufgabe mit vollständiger Beschreibung oder je eine Aufgabe pro Zeile erstellen. Titel, Beschreibung, Fälligkeit, Zuständigkeit und Sichtbarkeit lassen sich vor dem Speichern bearbeiten.

## Installation und Update

Das Modul ist für **Yuvomi 2.93.0** gebaut.

1. Als Admin in Yuvomi **Einstellungen → Module → Eigenes Modul hinzufügen** öffnen.
2. Das Installations-ZIP auswählen oder den [Modulordner auf GitHub](https://github.com/aquaneno/yuvomi-photo-tasks/tree/main/foto-aufgaben) angeben. Bei einem Update die Ersetzung von **Foto-Aufgaben** bestätigen.
3. Unter **Aktive Module** das Modul **Foto-Aufgaben** einschalten. Für Mitglieder in den Haushaltsberechtigungen Schreibrechte für **Foto-Aufgaben** und **Aufgaben** vergeben.

Die Installation über die Oberfläche braucht `MODULES_ALLOW_WEB_INSTALL=true` und einen schreibbaren, persistenten Modulordner. Bei einer manuellen Installation den Ordner `foto-aufgaben/` in das Host-Verzeichnis kopieren, das in Yuvomi als `/app/modules` eingebunden ist.

Ab Version **1.1.0** kannst du nach erfolgreichem Update den alten OCR-Container stoppen und die frühere Proxy-Regel für `/api/extensions/foto-aufgaben/` entfernen. Die neue Version benötigt nur Yuvomi und einen aktuellen Browser mit Web Workers und `DecompressionStream`.

## Bedienung

1. **Foto-Aufgaben** öffnen und **Foto aufnehmen** oder **Bild auswählen** wählen.
2. **Text erkennen** antippen. Der Browser lädt das OCR-Modul und die Sprachmodelle vom eigenen Yuvomi-Server. Das erstmalige Laden kann bei einer langsamen Verbindung etwas dauern.
3. Den Text korrigieren, eine Aufteilung wählen und **Vorschläge erstellen** antippen.
4. Die Aufgaben prüfen. Bei Bedarf pro Aufgabe **Originalfoto anhängen** aktivieren und **Aufgaben speichern** wählen.

Die Texterkennung läuft auf dem Gerät. Wenn du den Anhang auswählst, speichert Yuvomi die unveränderte Originaldatei zusätzlich als verknüpftes Dokument im Systemordner **Aufgaben**. Dafür brauchst du Schreibrechte für **Dokumente**. Die Freigabe des Dokuments entspricht beim Speichern der Sichtbarkeit und Zuweisung der Aufgabe. Spätere Änderungen der Aufgabe ändern die Dokumentfreigabe nicht. Unterstützte Bildformate für Anhänge sind JPEG, PNG und WebP innerhalb des Dateilimits deiner Yuvomi-Instanz. Die Erkennungsqualität hängt von Schärfe, Beleuchtung und Schrift ab. Bei Handschrift kannst du auf dem iPhone alternativ den Text mit **Live Text** kopieren und in das Modul einfügen.

## OCR-Assets reproduzieren

Die Laufzeit und Sprachmodelle liegen als installierbare Modul-Assets unter `foto-aufgaben/vendor/`. Für einen Neubau werden Node.js und die unten aufgeführten Build-Abhängigkeiten benötigt.

```sh
npm install --no-save --package-lock=false binaryen@132.0.0 esbuild@0.28.2 tesseract.js-core@7.0.0
node scripts/build-ocr.mjs
```
