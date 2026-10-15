# etü-Extraktor

Holt den Fliesstext der Artikel aus dem fertigen etü-PDF (aus Affinity exportiert) und bereitet ihn für den Blog auf: ohne Silbentrennung und Zeilenumbrüche, mit Absätzen, Zwischentiteln, Kursivem, Zitaten und Literatur am Schluss.

Das Werkzeug läuft vollständig im Browser. Das PDF wird nirgends hochgeladen.

## Benutzen

1. Die Seite öffnen (Link von GitHub Pages, siehe unten).
2. Das PDF hineinziehen, als ganzes Heft oder einzelner Artikel.
3. Links den Artikel wählen. In der Mitte zeigen farbige Kästen, was als Titel, Lead, Text usw. erkannt wurde.
   - Kasten anklicken → Typ ändern, früher/später, mit dem vorherigen verbinden, löschen.
   - Auf der Seite ziehen → neuen Kasten zeichnen (auch über gelöschtem Text).
4. Rechts mit «Kopieren» den Text holen: In der Vorschau formatiert (für WordPress), unter «Reiner Text» als reiner Text.

## Tastenkürzel

Gelten, wenn ein Kasten ausgewählt ist:

| Taste | Typ |
|---|---|
| `T` | Titel |
| `L` | Lead |
| `A` | Autor:in |
| `U` | Zwischentitel |
| `Q` | Frage |
| `X` | Text |
| `Z` | Zitat |
| `R` | Literatur |
| `B` | Bildlegende |
| `I` | Ignorieren |

| Taste | Aktion |
|---|---|
| `Entf` / `Backspace` | Kasten löschen |
| `Strg` + `Z` / `Cmd` + `Z` | Rückgängig |
| `Esc` | Auswahl aufheben bzw. «Reihenfolge» beenden |
| `Strg` / `Cmd` + Mausrad | PDF zoomen |

## Artikel und Seiten

Artikelgrenzen: Seitenzahlen beim gewählten Artikel ändern; die Nachbarartikel passen sich an. Seiten ohne Artikel erscheinen gelb als «nicht zugeordnet» und lassen sich teilen oder mit «als Artikel» übernehmen.

«Sitzung speichern» legt eine kleine `.sitzung.json` ab (alle Artikel, Kästen, Zeichen-Korrekturen). Zusammen mit dem PDF kann jemand anderes damit weiterarbeiten: PDF öffnen, dann «Sitzung laden».

## Neue Ausgabe: Heftfarbe anpassen

Nur `heft.json` ändern (direkt auf GitHub mit dem Stift-Symbol):

```json
{
  "ausgabe": "FS27 «Titel»",
  "farbe": "#5bad85",
  "schriftfarbe": "#111111"
}
```

- `farbe`: Farbe des Covers als Farbcode.
- `schriftfarbe`: Schrift auf dieser Farbe (`#111111` (schwarz) bei hellen, `#ffffff` (weiss) bei dunklen Farben.)

Nach dem Speichern baut GitHub die Seite automatisch neu (1-2 Minuten).

## Aufbau

| Datei | Inhalt |
|---|---|
| `src/app.html` | Oberfläche (Aussehen und Bedienung) |
| `src/core.js` | Erkennung: Zeilen, Spalten, Absätze, Silbentrennung, Ligaturen, Kasten-Typen |
| `heft.json` | Name und Farbe der aktuellen Ausgabe |
| `build.mjs` | setzt alles zu `dist/index.html` zusammen |
| `.github/workflows/pages.yml` | baut und veröffentlicht bei jeder Änderung automatisch |

Das PDF liest [pdf.js](https://mozilla.github.io/pdf.js/) (Mozilla), das beim Öffnen von cdnjs geladen wird. Die Seite braucht deshalb eine Internetverbindung.

## Einrichten (einmalig)

1. Repository auf GitHub anlegen und alle Dateien hochladen.
2. **Settings → Pages → Build and deployment → Source: «GitHub Actions»** wählen.
3. Unter **Actions** erscheint der Lauf «Seite bauen und veröffentlichen». Wenn er grün ist, steht die Adresse unter Settings → Pages.
