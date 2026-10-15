/* etü-Extraktor – Kernlogik (läuft im Browser und in Node) */
(function (root) {
  'use strict';

  const TYPES = {
    titel:   { label: 'Titel',          color: '#2e7d32', key: 't' },
    lead:    { label: 'Lead',           color: '#558b2f', key: 'l' },
    autor:   { label: 'Autor:in',       color: '#00897b', key: 'a' },
    zt:      { label: 'Zwischentitel',  color: '#6a1b9a', key: 'u' },
    frage:   { label: 'Frage',          color: '#ad1457', key: 'q' },
    text:    { label: 'Text',           color: '#1565c0', key: 'x' },
    zitat:   { label: 'Zitat',          color: '#0277bd', key: 'z' },
    noten:   { label: 'Literatur',      color: '#e65100', key: 'r' },
    legende: { label: 'Bildlegende',    color: '#8d6e63', key: 'b' },
    ignore:  { label: 'Ignorieren',     color: '#9e9e9e', key: 'i' },
  };

  const LIG_OPTIONS = ['Th', 'ff', 'ffi', 'ffl', 'fb', 'fk', 'fh', 'fj', 'ft', 'fi', 'fl', 'tt'];

  // ---------- Schriften ----------
  function fontInfo(rawName) {
    const name = String(rawName || '').replace(/^[A-Z]{6}\+/, '');
    const italic = /italic|oblique|kursiv/i.test(name);
    const bold = /bold|black|heavy|semibold/i.test(name);
    const family = name.replace(/[-,_ ]?(Regular|Italic|Oblique|Bold|BoldItalic|Medium|Light|Book|Roman|Semibold|Black)+$/i, '') || name;
    return { name, italic, bold, family };
  }

  // ---------- Zeilen aus pdf.js-Textelementen ----------
  // items: pdf.js TextItem[] (str, transform, width, fontName, hasEOL)
  // toView: (x,y) => [vx,vy] (Viewport bei scale 1)
  // fonts: fontName -> {name, italic, family}
  function buildLines(items, toView, fonts, pageNum) {
    const frags = [];
    for (const it of items) {
      if (!it.str) continue;
      const t = it.transform;
      const size = Math.hypot(t[2], t[3]) || Math.hypot(t[0], t[1]);
      if (size < 2) continue;
      const [x, y] = toView(t[4], t[5]);
      const [x2] = toView(t[4] + it.width, t[5]);
      frags.push({ str: it.str, x0: Math.min(x, x2), x1: Math.max(x, x2), base: y, size, font: it.fontName, w: it.width });
    }
    // Ligatur-Glyphen markieren (eigene Schrift, klebt mitten im Wort)
    const L = /[A-Za-zÀ-ÿ]/;
    for (let i = 0; i < frags.length; i++) {
      const f = frags[i], a = frags[i - 1], b = frags[i + 1];
      if (f.str.length > 2 || /\s/.test(f.str)) continue;
      if ((a && a.font === f.font && /\S/.test(a.str)) || (b && b.font === f.font && /\S/.test(b.str))) continue;
      const tol = 0.15 * f.size;
      const gP = a && Math.abs(f.base - a.base) < 0.5 && Math.abs(f.x0 - a.x1) <= tol;
      const gN = b && Math.abs(f.base - b.base) < 0.5 && Math.abs(b.x0 - f.x1) <= tol;
      const prevL = gP && L.test(a.str.slice(-1));
      const nextL = gN && L.test(b.str[0]);
      const rel = (f.x1 - f.x0) / f.size;
      let cls = null;
      if (!prevL && gN && /^[a-zäöü]/.test(b.str) && rel > 1.0 && rel < 1.25) cls = 'th';          // «Th» am Wortanfang
      else if (prevL && nextL) {
        if (rel > 0.68 && rel < 0.82) cls = 'narrow';
        else if (rel >= 0.82 && rel < 1.0) cls = 'wide';
        else if (rel >= 1.1 && rel < 1.35) cls = 'triple';
      } else if (prevL && !nextL && rel > 0.68 && rel < 0.82) cls = 'narrow';                     // «Schiff», «griff»
      // sonstiges Einzelzeichen aus fremder Schrift, das am Wort klebt (z.B. «Š» als «.») → zur Prüfung
      if (!cls && f.str.length === 1 && gN && L.test(b.str[0]) && !/[A-Za-zäöüÄÖÜß]/.test(f.str)) cls = 'odd';
      if (cls) f.lig = { key: f.font + '|' + f.str + '|' + cls, cls, raw: f.str };
    }

    const lines = [];
    let cur = null;
    const flush = () => { if (cur && cur.segs.length) lines.push(cur); cur = null; };
    for (const f of frags) {
      const fi = fonts[f.font] || fontInfo('');
      if (cur) {
        const dBase = f.base - cur.base;
        const gap = f.x0 - cur.x1;
        const isSup = dBase < -0.15 * cur.size && f.size < 0.85 * cur.size && gap > -1 && gap < cur.size;
        const sameLine = (Math.abs(dBase) < 0.35 * Math.max(f.size, cur.size) || isSup) && gap > -0.4 * Math.max(f.size, cur.size) && gap < 1.6 * Math.max(f.size, cur.size);
        if (!sameLine) flush();
      }
      if (!cur) {
        cur = { page: pageNum, x0: f.x0, x1: f.x1, base: f.base, size: f.size, segs: [], chars: {} };
      } else {
        const gap = f.x0 - cur.x1;
        const last = cur.segs[cur.segs.length - 1];
        if (gap > 0.18 * f.size && !/\s$/.test(last.t) && !/^\s/.test(f.str)) pushSeg(cur, ' ', last.i, false);
      }
      const isSup = cur.segs.length && (f.base - cur.base) < -0.15 * cur.size && f.size < 0.85 * cur.size;
      if (f.lig) pushSeg(cur, '\u0000', fi.italic, false, f.lig);
      else pushSeg(cur, f.str, fi.italic, isSup);
      cur.x1 = Math.max(cur.x1, f.x1); cur.x0 = Math.min(cur.x0, f.x0);
      if (!isSup && !f.lig) {
        const n = f.str.replace(/\s/g, '').length;
        const k = fi.family + '|' + Math.round(f.size * 2) / 2;
        cur.chars[k] = (cur.chars[k] || 0) + n;
        cur.italicN = (cur.italicN || 0) + (fi.italic ? n : 0);
        cur.allN = (cur.allN || 0) + n;
      }
    }
    flush();
    // Zeilenstücke auf gleicher Grundlinie, die direkt aneinanderstossen, zusammenfügen
    for (let i = 0; i < lines.length; i++) {
      for (let j = 0; j < lines.length; j++) {
        if (i === j || !lines[i] || !lines[j]) continue;
        const a = lines[i], b = lines[j];
        const gap = b.x0 - a.x1;
        if (Math.abs(a.base - b.base) < 0.3 * a.size && gap > -0.4 * a.size && gap < 0.6 * a.size && b.x0 > a.x0) {
          if (gap > 0.18 * a.size) pushSeg(a, ' ', false, false);
          for (const s of b.segs) a.segs.push(s);
          a.x1 = Math.max(a.x1, b.x1);
          for (const [k, n] of Object.entries(b.chars)) a.chars[k] = (a.chars[k] || 0) + n;
          a.italicN = (a.italicN || 0) + (b.italicN || 0); a.allN = (a.allN || 0) + (b.allN || 0);
          lines[j] = null; i = -1; break;
        }
      }
    }
    for (let i = lines.length - 1; i >= 0; i--) if (!lines[i]) lines.splice(i, 1);
    for (const l of lines) {
      let best = null, bn = -1;
      for (const [k, n] of Object.entries(l.chars)) if (n > bn) { bn = n; best = k; }
      const [fam, sz] = (best || '|10').split('|');
      l.family = fam; l.size = parseFloat(sz) || l.size;
      l.italic = l.allN ? l.italicN / l.allN > 0.85 : false;
      l.top = l.base - 0.78 * l.size; l.bottom = l.base + 0.22 * l.size;
      // Text trimmen
      while (l.segs.length && /^\s*$/.test(l.segs[0].t)) l.segs.shift();
      while (l.segs.length && /^\s*$/.test(l.segs[l.segs.length - 1].t)) l.segs.pop();
      if (l.segs.length) l.segs[0].t = l.segs[0].t.replace(/^\s+/, '');
      if (l.segs.length) { const s = l.segs[l.segs.length - 1]; s.t = s.t.replace(/\s+$/, ''); }
      delete l.chars;
    }
    return lines.filter(l => l.segs.length && plain(l).trim());
  }

  function pushSeg(line, t, italic, sup, lig) {
    const last = line.segs[line.segs.length - 1];
    if (!lig && last && !last.lig && last.i === italic && last.sup === sup) last.t += t;
    else line.segs.push(lig ? { t, i: italic, sup: false, lig } : { t, i: italic, sup });
  }

  function plain(line, ligMap) {
    return line.segs.map(s => s.lig ? ((ligMap && ligMap[s.lig.key]) || s.lig.raw) : s.t).join('');
  }

  // ---------- Blöcke ----------
  // «1»  …  «Bächler, Emil: …» auf derselben Grundlinie zusammenführen
  function mergeNumberLines(lines) {
    const out = lines.slice();
    for (const l of lines) {
      const t = plain(l).trim();
      if (!/^\d{1,3}[.)]?$/.test(t)) continue;
      const partner = out.filter(o => o !== l && Math.abs(o.base - l.base) < 0.3 * l.size && o.x0 > l.x1 && o.x0 - l.x1 < 12 * l.size)
        .sort((a, b) => a.x0 - b.x0)[0];
      if (!partner) continue;
      const merged = { ...partner, segs: [{ t: t + ' ', i: false, sup: false }, ...partner.segs], x0: l.x0, numIndent: true };
      out[out.indexOf(partner)] = merged;
      out.splice(out.indexOf(l), 1);
    }
    return out;
  }

  function groupBlocks(lines, pageW, pageH, bodySize) {
    lines = mergeNumberLines(lines);
    const sorted = lines.slice().sort((a, b) => a.top - b.top || a.x0 - b.x0);
    const blocks = [];
    for (const l of sorted) {
      let target = null;
      for (const b of blocks) {
        const last = b.lines[b.lines.length - 1];
        const gap = l.top - last.bottom;
        if (gap < -0.5 * l.size || gap > 0.62 * Math.max(l.size, last.size)) continue;
        const ov = Math.min(l.x1, b.x1) - Math.max(l.x0, b.x0);
        if (ov < 0.3 * Math.min(l.x1 - l.x0, b.x1 - b.x0)) continue;
        if (!compatible(last, l, bodySize)) continue;
        target = b; break;
      }
      if (!target) { target = { lines: [], x0: l.x0, x1: l.x1, top: l.top, bottom: l.bottom }; blocks.push(target); }
      target.lines.push(l);
      target.x0 = Math.min(target.x0, l.x0); target.x1 = Math.max(target.x1, l.x1);
      target.top = Math.min(target.top, l.top); target.bottom = Math.max(target.bottom, l.bottom);
    }
    return blocks;
  }

  function compatible(a, b, body) {
    const sa = a.size, sb = b.size;
    if (Math.abs(sa - sb) < 0.6) {
      if (sa > body + 1 && a.family !== b.family) return false; // Titel ≠ Autor:in
      return true;
    }
    const small = s => s < body - 0.4, bod = s => Math.abs(s - body) < 0.6;
    return (small(sa) && bod(sb)) || (bod(sa) && small(sb)); // Legenden: Label + Text
  }

  function recomputeBox(b) {
    b.x0 = Math.min(...b.lines.map(l => l.x0)); b.x1 = Math.max(...b.lines.map(l => l.x1));
    b.top = Math.min(...b.lines.map(l => l.top)); b.bottom = Math.max(...b.lines.map(l => l.bottom));
  }

  // ---------- Statistik ----------
  function dominant(lines) {
    const fam = {}, size = {};
    for (const l of lines) {
      const n = plain(l).length;
      fam[l.family] = (fam[l.family] || 0) + n;
      const s = Math.round(l.size * 2) / 2; size[s] = (size[s] || 0) + n;
    }
    const top = o => Object.entries(o).sort((a, b) => b[1] - a[1])[0];
    return { family: (top(fam) || ['', 0])[0], size: parseFloat((top(size) || [10])[0]) };
  }

  // ---------- Klassifizierung ----------
  const NOTE_HEAD = /^(Literatur|Anmerkungen|Quellen|Endnoten|Fussnoten|Fußnoten|Bibliogra(f|ph)ie|Literaturverzeichnis|Quellen\s*und\s*Literatur|Weiterführende)/i;

  function classifyBlock(b, page, stats) {
    const body = stats.size;
    const txt = b.lines.map(l => plain(l)).join(' ').trim();
    const maxS = Math.max(...b.lines.map(l => l.size));
    const minS = Math.min(...b.lines.map(l => l.size));
    if (/^[\d\s]{1,4}$/.test(txt) && (b.top > page.h * 0.85 || b.bottom < page.h * 0.12)) return 'ignore';
    if (maxS >= 42) return 'ignore';
    if (maxS >= 24) return 'titel';
    if (maxS >= 16.5 && b.lines[0].family === stats.family) return 'lead';
    if (minS < body - 0.4) {
      if (NOTE_HEAD.test(plain(b.lines[0]).trim())) return 'noten';
      const numbered = b.lines.filter(l => /^\d{1,3}[\s.)]/.test(plain(l))).length;
      if (numbered >= 2 && b.lines.every(l => l.size < body - 0.4)) return 'noten';
      return 'legende';
    }
    if (b.lines[0].family !== stats.family && maxS > body + 0.4 && b.lines.length <= 4) {
      // Frage oder Zwischentitel? Wird pro Artikel entschieden (refineArticle)
      return txt.length > 90 ? 'frage' : 'zt';
    }
    if (b.lines[0].family !== stats.family && b.lines.length <= 4 && /\?\s*$/.test(txt)) return 'frage';
    if (maxS >= 16.5) return 'lead';
    if (b.lines.every(l => l.italic)) return 'zitat';
    return 'text';
  }

  // Lesereihenfolge auf einer Seite: Spalten = Gruppen von Blöcken mit überlappender x-Ausdehnung
  function pageOrder(blocks, W) {
    const xov = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    const yov = (a, b) => Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    // «Brücke» = Block, der über zwei nebeneinanderliegende Spalten reicht
    const bridges = new Set();
    for (const B of blocks) {
      const touch = blocks.filter(o => o !== B && xov(o, B) > 5);
      outer: for (let i = 0; i < touch.length; i++) for (let j = i + 1; j < touch.length; j++) {
        if (xov(touch[i], touch[j]) < 0 && yov(touch[i], touch[j]) > 0) { bridges.add(B); break outer; }
      }
    }
    const narrow = blocks.filter(b => !bridges.has(b));
    const colTop = narrow.length ? Math.min(...narrow.map(b => b.top)) : Infinity;
    const heads = blocks.filter(b => bridges.has(b) && b.top < colTop + 2).sort((a, b) => a.top - b.top);
    const restWide = blocks.filter(b => bridges.has(b) && !heads.includes(b)).sort((a, b) => a.top - b.top);
    // Union-Find über x-Überlappung
    const parent = narrow.map((_, i) => i);
    const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
    for (let i = 0; i < narrow.length; i++) for (let j = i + 1; j < narrow.length; j++) {
      const a = narrow[i], b = narrow[j];
      const ov = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      if (ov > 0.15 * Math.min(a.x1 - a.x0, b.x1 - b.x0) || ov > 20) parent[find(i)] = find(j);
    }
    const groups = {};
    narrow.forEach((b, i) => (groups[find(i)] ||= []).push(b));
    const cols = Object.values(groups).map(g => g.sort((a, b) => a.top - b.top))
      .sort((a, b) => Math.min(...a.map(x => x.x0)) - Math.min(...b.map(x => x.x0)));
    // Spalten, die nicht nebeneinander, sondern untereinander liegen, nach Höhe ordnen
    return [...heads, ...cols.flat(), ...restWide];
  }

  // Artikel-weite Nachbearbeitung: Titel vs. Autor:in, Pull-Quotes
  function refineArticle(blocks) {
    // Interview erkennen: viele hervorgehobene Blöcke mit «?» → das sind Fragen, sonst Zwischentitel
    const btxt = b => b.lines.map(l => plain(l)).join(' ').trim();
    const qs = blocks.filter(b => (b.type === 'zt' || b.type === 'frage') && /\?\s*$/.test(btxt(b)));
    if (qs.length >= 3) { qs.forEach(b => { b.type = 'frage'; }); blocks.forEach(b => { if (b.type === 'zt' && btxt(b).length > 40) b.type = 'frage'; }); }
    else blocks.forEach(b => { if (b.type === 'frage' && b.lines.length <= 2) b.type = 'zt'; });
    const leadIdx = blocks.findIndex(b => b.type === 'lead');
    const titles = blocks.filter(b => b.type === 'titel');
    if (leadIdx >= 0) {
      blocks.forEach((b, i) => { if (b.type === 'titel' && i > leadIdx && b.page === blocks[leadIdx].page) b.type = 'autor'; });
    } else if (titles.length >= 2 && titles[0].page === titles[titles.length - 1].page) {
      titles[titles.length - 1].type = 'autor';
    }
    // Titel nur auf erster Seite; spätere grosse Schrift -> ignorieren
    const firstPage = blocks.length ? blocks[0].page : 0;
    blocks.forEach(b => { if ((b.type === 'titel' || b.type === 'autor' || b.type === 'lead') && b.page !== firstPage) b.type = 'ignore'; });
    // Hervorgehobene Zitate, die im Fliesstext schon vorkommen
    const norm = s => s.toLowerCase().replace(/[^a-zäöüß]/g, '');
    const bodyNorm = norm(blocks.filter(b => b.type === 'text').map(b => b.lines.map(l => plain(l).replace(/-$/, '')).join('')).join(''));
    blocks.forEach(b => {
      if (b.type !== 'zitat') return;
      const n = norm(b.lines.map(l => plain(l).replace(/-$/, '')).join(''));
      if (n.length > 30 && bodyNorm.includes(n.slice(5, Math.min(n.length - 5, 80)))) { b.type = 'ignore'; b.auto = 'Wiederholtes Zitat (Pull-Quote)'; }
    });
  }

  // ---------- Ligaturen ----------
  // Fortsetzungen nach der Ligatur (Kleinbuchstaben), längster Treffer gewinnt
  const CONT = {
    fb: 'au aut äu ew esc esi ere ere ega ehe ei ek eg ra rac rau ruc rü ri ro rie lüh lic lie lä ar ahn ess ett eu ot ur',
    fk: 'lä lär lap lag lei lub omm ont ons ost ult ant auf äu ra re ri ro reu reis on ur un eh no näu',
    fh: 'erd irt orc alt ält in ine eb ebu ör ol äng ang and än au ei ell eu ilf of üt',
    ffi: 'z zi x nd nde ndb ndi nan gur lm',
    ffl: 'amm ieg ieh ieß ug üg uss üss ach ores',
  };
  const CONTLIST = Object.fromEntries(Object.entries(CONT).map(([k, v]) => [k, v.split(' ')]));

  function scoreWide(prev, next) {
    const nx = next.toLowerCase();
    const sc = { fb: 0.1, fk: 0, fh: 0, ffi: 0, ffl: 0 };
    for (const [k, list] of Object.entries(CONTLIST)) {
      let best = 0;
      for (const c of list) if (nx.startsWith(c) && c.length > best) best = c.length;
      sc[k] += best;
    }
    if (/(o|e|su|schi|gri|ka)$/i.test(prev) && /^[zx]/.test(nx)) sc.ffi += 2;
    return sc;
  }

  function resolveLigatures(allLines) {
    const groups = {};
    for (const l of allLines) {
      l.segs.forEach((s, i) => {
        if (!s.lig) return;
        const prev = l.segs.slice(0, i).map(x => x.lig ? 'f' : x.t).join('').match(/[A-Za-zÀ-ÿ]*$/)[0];
        const next = l.segs.slice(i + 1).map(x => x.lig ? 'f' : x.t).join('').match(/^[A-Za-zÀ-ÿ]*/)[0];
        const g = groups[s.lig.key] ||= { key: s.lig.key, cls: s.lig.cls, raw: s.lig.raw, examples: [], score: {} };
        g.examples.push([prev, next]);
        if (s.lig.cls === 'wide') {
          const sc = scoreWide(prev, next);
          for (const [k, v] of Object.entries(sc)) g.score[k] = (g.score[k] || 0) + v;
        }
      });
    }
    const map = {};
    for (const g of Object.values(groups)) {
      if (g.cls === 'narrow') g.guess = 'ff';
      else if (g.cls === 'th') g.guess = 'Th';
      else if (g.cls === 'odd') g.guess = g.raw;
      else if (g.cls === 'triple') g.guess = 'ffi';
      else g.guess = Object.entries(g.score).sort((a, b) => b[1] - a[1])[0][0];
      map[g.key] = g.guess;
    }
    return { groups, map };
  }

  // ---------- Textaufbau ----------
  function segsToRuns(line, ligMap) {
    // Ergebnis: [{t, i, sup}]
    const runs = [];
    for (const s of line.segs) {
      const t = s.lig ? (ligMap[s.lig.key] || s.lig.raw) : s.t;
      const last = runs[runs.length - 1];
      if (last && last.i === s.i && last.sup === s.sup) last.t += t; else runs.push({ t, i: s.i, sup: s.sup });
    }
    return runs;
  }

  // Zeilen eines Fliesstext-Stroms zu Absätzen
  // items: [{line, colLeft, colRight, kind}]  → Absätze [{kind, runs}]
  function linesToParagraphs(seq, ligMap, opts) {
    const paras = [];
    let cur = null, prevLine = null, prevMeta = null;
    for (const { line, colLeft, colRight, kind, forceNew, ragged, join } of seq) {
      const runs = segsToRuns(line, ligMap);
      const text = runs.map(r => r.t).join('');
      const indent = line.x0 - colLeft > 0.8 * line.size;
      let newPara = !cur || cur.kind !== kind || forceNew;
      if (join && cur) { appendRuns(cur, runs, true); prevLine = line; prevMeta = { colLeft, colRight, ragged }; continue; }
      if (!newPara && kind === 'noten' && /^\d{1,3}[\s.)]/.test(text) && line.x0 - colLeft < 0.5 * line.size) newPara = true;
      if (kind === 'noten' && NOTE_HEAD.test(text.trim()) && text.trim().length < 40) { cur = { kind, runs: [], head: true }; paras.push(cur); appendRuns(cur, runs, false); cur = null; prevLine = line; prevMeta = { colLeft, colRight }; continue; }
      if (!newPara && kind !== 'noten' && kind !== 'zitat') {
        if (indent && Math.abs(line.x1 - colRight) < 3 * line.size) newPara = true;
        else if (indent && line.x0 - colLeft > 2 * line.size) newPara = true;
        const prevText = prevLine ? plain(prevLine, ligMap).trim() : '';
        const prevShort = prevLine && prevMeta && (prevMeta.colRight - prevLine.x1) > 1.2 * prevLine.size;
        if (prevShort && !ragged && !prevMeta.ragged && /[.!?:»«"“”)…]$/.test(prevText)) newPara = true;
      }
      if (newPara) { cur = { kind, runs: [] }; paras.push(cur); appendRuns(cur, runs, false); }
      else appendRuns(cur, runs, true);
      prevLine = line; prevMeta = { colLeft, colRight, ragged };
    }
    return paras;
  }

  let LEX = null; // Wörter, die im Heft mitten in der Zeile mit Bindestrich vorkommen
  function setLexicon(lines) {
    LEX = new Set();
    for (const l of lines) {
      const toks = plain(l).split(/\s+/);
      toks.forEach((t, i) => {
        if (i === toks.length - 1) return; // Zeilenende kann Trennung sein
        const w = t.replace(/^[^\wÀ-ÿ]+|[^\wÀ-ÿ]+$/g, '').toLowerCase();
        if (/[a-zäöüß]-[a-zäöüß]/.test(w)) LEX.add(w);
      });
    }
  }
  function appendRuns(p, runs, join) {
    if (join && p.runs.length) {
      const last = p.runs[p.runs.length - 1];
      const first = runs[0];
      const m = last.t.match(/(\S*)[-­]$/);
      const nextWord = (first.t.match(/^\S+/) || [''])[0];
      const keepHyph = LEX && LEX.has((m ? m[1] : '').replace(/^[^\wÀ-ÿ]+/, '').toLowerCase() + '-' + nextWord.replace(/[^\wÀ-ÿ-]+$/, '').toLowerCase());
      if (m && keepHyph) {
        // Bindestrich gehört zum Wort (kommt im Heft auch mitten in der Zeile so vor)
      } else if (m && /^[a-zäöüß]/.test(nextWord) && !/^(und|oder|bis|sowie|bzw\.?|als|noch|statt)$/.test(nextWord.replace(/[.,;:]$/, '')) && !/\d$/.test(m[1])) {
        last.t = last.t.slice(0, -1); // Trennstrich weg
      } else if (m && /^(und|oder|bis|sowie|bzw)/.test(nextWord)) {
        last.t += ' ';
      } else if (/[-–\/]$/.test(last.t) && /^[A-ZÄÖÜ]/.test(nextWord)) {
        // Bindestrich-Kompositum: Dach-Gesellschaft -> kein Leerzeichen
      } else {
        last.t += ' ';
      }
    }
    for (const r of runs) {
      const last = p.runs[p.runs.length - 1];
      if (last && last.i === r.i && last.sup === r.sup) last.t += r.t; else p.runs.push({ ...r });
    }
  }

  // Ganzer Artikel → Struktur
  function assemble(article, pages, ligMap, opts = {}) {
    const order = article.order.map(id => article.blockById[id]).filter(b => b && b.type !== 'ignore');
    const head = { titel: [], lead: [], autor: [] };
    const bodySeq = [], noteSeq = [], capSeq = [];
    let prevB = null;
    for (const b of order) {
      const page = pages[b.page];
      const col = columnBounds(b, article.pageBlocks[b.page] || []);
      const split = prevB && prevB.page === b.page && prevB.type === b.type && b.top - prevB.bottom > 0.6 * b.lines[0].size &&
        Math.min(prevB.x1, b.x1) - Math.max(prevB.x0, b.x0) > 0;
      prevB = b;
      if (b.type in head) { head[b.type].push(b.lines.map(l => segsToRuns(l, ligMap))); continue; }
      const target = b.type === 'noten' ? noteSeq : b.type === 'legende' ? capSeq : bodySeq;
      b.lines.forEach((line, i) => target.push({ line, colLeft: col.left, colRight: col.right, ragged: col.ragged, kind: b.type, join: i === 0 && !!b.joinPrev, forceNew: i === 0 && !b.joinPrev && (b.type === 'zt' || b.type === 'frage' || b.type === 'zitat' || b.type === 'legende' || split) }));
    }
    const headText = k => head[k].map(blk => {
      const p = { runs: [] }; blk.forEach((runs, i) => appendRuns(p, runs, i > 0)); return runsText(p.runs);
    }).join(' ').replace(/\s+/g, ' ').trim();
    const body = linesToParagraphs(bodySeq, ligMap, opts);
    const notes = linesToParagraphs(noteSeq, ligMap, opts);
    const caps = linesToParagraphs(capSeq, ligMap, opts);
    for (const arr of [body, notes, caps]) arr.forEach(p => tidy(p));
    return { titel: headText('titel'), lead: headText('lead'), autor: headText('autor'), body, notes, caps };
  }

  function tidy(p) {
    for (const r of p.runs) r.t = r.t.replace(/[ \t]+/g, ' ');
    if (p.runs.length) p.runs[0].t = p.runs[0].t.replace(/^\s+/, '');
    if (p.runs.length) p.runs[p.runs.length - 1].t = p.runs[p.runs.length - 1].t.replace(/\s+$/, '');
    // Leerzeichen aus Kursivläufen an den Rand schieben (für sauberes HTML)
    p.runs = p.runs.filter(r => r.t.length);
  }

  function columnBounds(b, pageBlocks) {
    // linke Kante: eigene Zeilen (ohne Einzug), sonst ähnlich ausgerichtete Nachbarblöcke
    const sz = b.lines[0].size;
    const right = Math.max(...b.lines.map(l => l.x1));
    let left = Math.min(...b.lines.map(l => l.x0));
    if (b.lines.length < 3) {
      const cands = pageBlocks.filter(o => o !== b && o.lines.length >= 3 && (o.type === 'text' || o.type === b.type)
        && Math.min(o.x1, b.x1) - Math.max(o.x0, b.x0) > 0 && o.x0 <= left + 0.5 && left - o.x0 < 3 * sz);
      if (cands.length) left = Math.max(...cands.map(o => o.x0));
    }
    // Blocksatz oder Flattersatz?
    const inner = b.lines.slice(0, -1);
    const ragged = inner.length >= 2 && inner.filter(l => right - l.x1 > 0.8 * sz).length > inner.length * 0.4;
    let colRight = right;
    const peers = pageBlocks.filter(o => o.type === b.type && Math.min(o.x1, b.x1) - Math.max(o.x0, b.x0) > 0);
    if (peers.length) colRight = Math.max(colRight, ...peers.map(o => o.x1));
    return { left, right: colRight, ragged };
  }

  function runsText(runs) { return runs.map(r => r.t).join(''); }

  // ---------- Ausgabe ----------
  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function runsHtml(runs) {
    return runs.map(r => {
      let t = esc(r.t);
      if (r.sup) t = '<sup>' + t + '</sup>';
      if (r.i) { const m = t.match(/^(\s*)([\s\S]*?)(\s*)$/); t = m[1] + (m[2] ? '<em>' + m[2] + '</em>' : '') + m[3]; }
      return t;
    }).join('');
  }

  function toHtml(doc, opts = {}) {
    const out = [];
    if (opts.head !== false) {
      if (doc.titel) out.push('<h1>' + esc(doc.titel) + '</h1>');
      if (doc.lead) out.push('<p><strong>' + esc(doc.lead) + '</strong></p>');
      if (doc.autor) out.push('<p><em>' + esc(doc.autor) + '</em></p>');
    }
    out.push(...bodyHtml(doc.body));
    if (doc.notes.length) {
      out.push('<hr>');
      doc.notes.forEach((p, i) => {
        const t = runsText(p.runs);
        if (i === 0 && NOTE_HEAD.test(t) && t.length < 40) out.push('<h3>' + esc(t) + '</h3>');
        else out.push('<p>' + runsHtml(p.runs) + '</p>');
      });
    }
    if (opts.caps && doc.caps.length) {
      out.push('<h3>Bildlegenden</h3>');
      doc.caps.forEach(p => out.push('<p>' + runsHtml(p.runs) + '</p>'));
    }
    return out.join('\n');
  }

  function bodyHtml(paras) {
    return paras.map(p => {
      if (p.kind === 'zt') return '<h2>' + esc(runsText(p.runs)) + '</h2>';
      if (p.kind === 'frage') return '<p><strong>' + runsHtml(p.runs) + '</strong></p>';
      if (p.kind === 'zitat') return '<blockquote><p>' + runsHtml(p.runs) + '</p></blockquote>';
      return '<p>' + runsHtml(p.runs) + '</p>';
    });
  }

  function toText(doc, opts = {}) {
    const out = [];
    if (opts.head !== false) {
      if (doc.titel) out.push(doc.titel);
      if (doc.lead) out.push(doc.lead);
      if (doc.autor) out.push(doc.autor);
    }
    for (const p of doc.body) out.push(runsText(p.runs));
    if (doc.notes.length) { out.push('—'); for (const p of doc.notes) out.push(runsText(p.runs)); }
    if (opts.caps && doc.caps.length) { out.push('Bildlegenden'); for (const p of doc.caps) out.push(runsText(p.runs)); }
    return out.join('\n\n');
  }

  // ---------- Artikelerkennung (ganzes Heft) ----------
  // pageInfo: [{num, hasTitle, titleText, divider}]
  function detectArticles(pageInfo) {
    const arts = [];
    for (const p of pageInfo) {
      if (p.divider) { if (arts.length && !arts[arts.length - 1].end) arts[arts.length - 1].end = p.num - 1; continue; }
      if (p.hasTitle) {
        if (arts.length && !arts[arts.length - 1].end) arts[arts.length - 1].end = p.num - 1;
        arts.push({ start: p.num, end: null, title: p.titleText });
      }
    }
    if (arts.length && !arts[arts.length - 1].end) arts[arts.length - 1].end = pageInfo[pageInfo.length - 1].num;
    return arts;
  }

  function pageSummary(num, page) {
    const big = page.lines.filter(l => l.size >= 24 && l.size < 42 && l.top < page.h * 0.45 && !/^[\d\s]+$/.test(plain(l)));
    const divider = page.lines.some(l => l.size >= 42 && !/^[\d\s]+$/.test(plain(l)));
    const fam = big.length ? big[0].family : '';
    const tl = [];
    for (const l of big) { if (l.family !== fam || (tl.length && l.top - tl[tl.length - 1].bottom > l.size)) break; tl.push(l); }
    return { num, hasTitle: big.length > 0, divider, titleText: tl.map(l => plain(l)).join(' ') };
  }

  let blockSeq = 0;
  // pages: {num: {w,h,lines}}  → Artikelobjekt mit Blöcken und Reihenfolge
  function buildArticle(pages, start, end) {
    const nums = []; for (let n = start; n <= end; n++) if (pages[n]) nums.push(n);
    const allLines = nums.flatMap(n => pages[n].lines);
    const stats = dominant(allLines.filter(l => l.size < 16));
    const article = { start, end, stats, blockById: {}, order: [], pageBlocks: {} };
    const all = [];
    for (const n of nums) {
      const pg = pages[n];
      const blocks = groupBlocks(pg.lines, pg.w, pg.h, stats.size);
      blocks.forEach(b => { b.id = 'b' + (++blockSeq); b.page = n; b.type = classifyBlock(b, pg, stats); b.auto = null; });
      article.pageBlocks[n] = blocks;
      (article.pageLines ||= {})[n] = blocks.flatMap(b => b.lines);
      const ordered = pageOrder(blocks, pg.w);
      ordered.forEach(b => { article.blockById[b.id] = b; all.push(b); });
    }
    refineArticle(all);
    article.order = all.map(b => b.id);
    article.lig = resolveLigatures(allLines);
    return article;
  }

  // Kasten neu zeichnen: Zeilen im Rechteck in einen neuen Block verschieben
  function reassign(article, pageNum, rect) {
    const blocks = (article.pageBlocks[pageNum] ||= []);
    const inside = l => { const cx = (l.x0 + l.x1) / 2, cy = (l.top + l.bottom) / 2; return cx >= rect.x0 && cx <= rect.x1 && cy >= rect.top && cy <= rect.bottom; };
    const pool = (article.pageLines && article.pageLines[pageNum]) || blocks.flatMap(b => b.lines);
    const takenSet = new Set(pool.filter(inside));
    if (!takenSet.size) return null;
    const sources = blocks.filter(b => b.lines.some(l => takenSet.has(l)));
    const idxs = sources.map(b => article.order.indexOf(b.id)).filter(i => i >= 0);
    let idx;
    if (idxs.length) idx = Math.min(...idxs);
    else { // nur gelöschte Zeilen: nach dem letzten Kasten darüber einreihen
      const top = Math.min(...[...takenSet].map(l => l.top));
      const above = article.order.map((id, i) => [article.blockById[id], i]).filter(([b]) => b.page < pageNum || (b.page === pageNum && b.top < top));
      idx = above.length ? above[above.length - 1][1] + 1 : 0;
    }
    const taken = [...takenSet];
    const typeVotes = { text: 0.5 };
    for (const b of sources) {
      const keep = [];
      for (const l of b.lines) { if (takenSet.has(l)) typeVotes[b.type] = (typeVotes[b.type] || 0) + 1; else keep.push(l); }
      b.lines = keep;
    }
    const inBlocks = new Set(sources.flatMap(b => b.lines));
    for (const l of takenSet) if (!blocks.some(b => b.lines.includes(l)) && l.lastType) typeVotes[l.lastType] = (typeVotes[l.lastType] || 0) + 1;
    let type = Object.entries(typeVotes).sort((a, b) => b[1] - a[1])[0][0];
    if (type === 'ignore') type = 'text';
    const nb = { id: 'b' + (++blockSeq), page: pageNum, lines: taken.sort((a, b) => a.top - b.top || a.x0 - b.x0), type, manual: true };
    recomputeBox(nb);
    // leere Blöcke entfernen
    for (const b of sources) {
      if (!b.lines.length) {
        blocks.splice(blocks.indexOf(b), 1);
        delete article.blockById[b.id];
        const i = article.order.indexOf(b.id); if (i >= 0) article.order.splice(i, 1);
      } else recomputeBox(b);
    }
    blocks.push(nb);
    article.blockById[nb.id] = nb;
    const at = Math.min(idx, article.order.length);
    article.order.splice(at, 0, nb.id);
    // neue und verbliebene Teile in Lesereihenfolge bringen (oben vor unten)
    const group = [nb, ...sources.filter(b => b.lines.length)];
    const slots = group.map(b => article.order.indexOf(b.id)).sort((a, b) => a - b);
    group.sort((a, b) => {
      const ov = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      return ov > 0 ? a.top - b.top : a.x0 - b.x0;
    });
    slots.forEach((s, i) => { article.order[s] = group[i].id; });
    return nb;
  }

  function removeBlock(article, id) {
    const b = article.blockById[id]; if (!b) return;
    for (const l of b.lines) l.lastType = b.type;
    const bl = article.pageBlocks[b.page]; bl.splice(bl.indexOf(b), 1);
    delete article.blockById[id];
    article.order.splice(article.order.indexOf(id), 1);
  }
  // Block mit dem vorherigen (in Lesereihenfolge, nicht ignoriert) zusammenführen
  function mergeWithPrev(article, id) {
    const b = article.blockById[id]; if (!b) return null;
    const i = article.order.indexOf(id);
    let prev = null;
    for (let k = i - 1; k >= 0; k--) { const p = article.blockById[article.order[k]]; if (p.type !== 'ignore') { prev = p; break; } }
    if (!prev) return null;
    if (prev.page !== b.page) {
      // andere Seite: Typ übernehmen, direkt dahinter einreihen, Absatz fortsetzen
      b.type = prev.type; b.joinPrev = true;
      article.order.splice(i, 1);
      article.order.splice(article.order.indexOf(prev.id) + 1, 0, id);
      return b;
    }
    prev.lines = prev.lines.concat(b.lines).sort((x, y) => x.top - y.top || x.x0 - y.x0);
    recomputeBox(prev);
    removeBlock(article, id);
    return prev;
  }
  function snapshot(article) {
    return { start: article.start, end: article.end, order: article.order.slice(), pages: Object.fromEntries(Object.entries(article.pageBlocks).map(([n, bl]) => [n, bl.map(b => ({ ...b, lines: b.lines.slice() }))])) };
  }
  function restore(article, snap) {
    article.order = snap.order.slice(); article.pageBlocks = {}; article.blockById = {};
    for (const [n, bl] of Object.entries(snap.pages)) {
      article.pageBlocks[n] = bl.map(b => ({ ...b, lines: b.lines.slice() }));
      for (const b of article.pageBlocks[n]) article.blockById[b.id] = b;
    }
  }

  // ---------- Sitzung ----------
  const lineKey = l => l.page + '|' + Math.round(l.base * 2) + '|' + Math.round(l.x0 * 2);
  function serializeArticle(article) {
    return {
      start: article.start, end: article.end,
      order: article.order.slice(),
      blocks: Object.values(article.pageBlocks).flat().map(b => ({ id: b.id, page: b.page, type: b.type, joinPrev: !!b.joinPrev, lines: b.lines.map(lineKey) })),
    };
  }
  function restoreArticle(pages, saved) {
    const art = buildArticle(pages, saved.start, saved.end);
    const byKey = {};
    for (const bl of Object.values(art.pageBlocks)) for (const b of bl) for (const l of b.lines) byKey[lineKey(l)] = l;
    art.pageBlocks = {}; art.blockById = {};
    for (const n of Object.keys(pages)) if (+n >= saved.start && +n <= saved.end) art.pageBlocks[n] = [];
    let missing = 0;
    for (const sb of saved.blocks) {
      const lines = sb.lines.map(k => byKey[k]).filter(Boolean);
      missing += sb.lines.length - lines.length;
      if (!lines.length) continue;
      const b = { id: sb.id, page: sb.page, type: sb.type, joinPrev: sb.joinPrev, lines };
      recomputeBox(b);
      (art.pageBlocks[b.page] ||= []).push(b); art.blockById[b.id] = b;
      const num = +String(sb.id).replace(/\D/g, ''); if (num > blockSeq) blockSeq = num;
    }
    art.order = saved.order.filter(id => art.blockById[id]);
    for (const id of Object.keys(art.blockById)) if (!art.order.includes(id)) art.order.push(id);
    art.restoreMissing = missing;
    return art;
  }

  function articleTitle(article) {
    const t = article.order.map(id => article.blockById[id]).filter(b => b && b.type === 'titel')
      .flatMap(b => b.lines.map(l => plain(l, article.lig && article.lig.map))).join(' ').trim();
    return t;
  }

  const api = { serializeArticle, restoreArticle, setLexicon, TYPES, pageSummary, buildArticle, reassign, articleTitle, removeBlock, mergeWithPrev, snapshot, restore, LIG_OPTIONS, fontInfo, buildLines, groupBlocks, recomputeBox, dominant, classifyBlock, pageOrder, refineArticle, resolveLigatures, assemble, toHtml, toText, detectArticles, plain, runsText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.EtueCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
