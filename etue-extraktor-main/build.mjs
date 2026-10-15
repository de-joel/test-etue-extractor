// Baut aus src/app.html, src/core.js und heft.json die fertige Seite dist/index.html.
// Aufruf: node build.mjs   (Node 18 oder neuer, keine weiteren Pakete nötig)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38';

const heft = JSON.parse(readFileSync('heft.json', 'utf8'));
const isColor = c => /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(c);
if (!isColor(heft.farbe)) throw new Error('heft.json: «farbe» muss ein Farbcode wie #5bad85 sein');
if (!isColor(heft.schriftfarbe)) throw new Error('heft.json: «schriftfarbe» muss ein Farbcode wie #111111 sein');

const app = readFileSync('src/app.html', 'utf8');
const core = readFileSync('src/core.js', 'utf8');

const body = app
  .replace('/*CORE*/', () => core)
  .replaceAll('__PDFJS__', PDFJS)
  .replace('__FARBE__', heft.farbe)
  .replace('__SCHRIFTFARBE__', heft.schriftfarbe)
  .replace('__AUSGABE__', String(heft.ausgabe || '').replace(/\*\//g, ''));

const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
</head>
<body>
${body}
</body>
</html>
`;

mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', html);
console.log(`dist/index.html gebaut (${heft.ausgabe}, Farbe ${heft.farbe}, ${Math.round(html.length / 1024)} KB)`);
