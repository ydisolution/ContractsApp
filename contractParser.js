/**
 * contractParser.js — Turn an uploaded contract file into a fillable template.
 *
 * Supported inputs:
 *   .docx            → convert to HTML with `mammoth`, then detect placeholders
 *   .html / .htm     → use as-is
 *   .txt             → wrap paragraphs in <p> tags
 *
 * Field detection passes:
 *   1. {{name}} or {{name:label}} placeholders   (explicit — preferred)
 *   2. [name]                                     (square-bracket placeholder)
 *   3. long runs of "_______" (auto-named f1, f2, …)
 *
 * Detected fields preserve order, carry a group (taken from the nearest
 * preceding heading), and expose a kind hint ("amount" if the label mentions
 * price/sum/amount — triggers the number→words helper on the client).
 */

const mammoth = require('mammoth');

const RE_DOUBLE = /\{\{\s*([^\s}][^}]*?)\s*\}\}/g;     // {{field}} or {{field:Label}}
const RE_SQUARE = /\[\s*([A-Za-z_\u0590-\u05FF][^\]\n]{0,60})\s*\]/g;
const RE_LINE   = /_{4,}/g;

// ── Parse the uploaded buffer into { html, title, fields } ────────────────────
async function parseBuffer(buffer, filename) {
  const lower = String(filename || '').toLowerCase();

  // ── Reject formats we can't parse, BEFORE we accidentally render the
  //    raw bytes as "text" and end up with a template full of mojibake.
  if (lower.endsWith('.pdf')) {
    throw new Error('קבצי PDF אינם נתמכים כתבניות. פתח את הקובץ ב-Word, שמור אותו כ-.docx, והעלה אותו מחדש.');
  }
  if (/\.(doc|rtf|odt|pages)$/.test(lower)) {
    const ext = lower.split('.').pop();
    throw new Error(`פורמט .${ext} לא נתמך. שמור את הקובץ כ-.docx (Word) והעלה אותו מחדש.`);
  }
  // Magic-byte guard: even if someone renamed a PDF to .txt/.html, detect it
  if (buffer.length >= 5 && buffer.slice(0, 5).toString('ascii') === '%PDF-') {
    throw new Error('הקובץ הוא למעשה PDF (על אף סיומת אחרת). המר ל-.docx והעלה מחדש.');
  }

  let html;
  if (lower.endsWith('.docx')) {
    try {
      const r = await mammoth.convertToHtml({ buffer });
      html = r.value;
    } catch (e) {
      throw new Error('לא ניתן לקרוא את קובץ ה-Word. ייתכן שהוא פגום או בגרסה ישנה מדי. שמור שוב כ-.docx.');
    }
  } else if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    html = buffer.toString('utf8');
  } else if (lower.endsWith('.txt') || !lower.includes('.')) {
    const text = buffer.toString('utf8');
    html = text
      .split(/\n{2,}/)
      .map(p => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`)
      .join('\n');
  } else {
    const ext = lower.split('.').pop();
    throw new Error(`סיומת .${ext} לא נתמכת. השתמש ב-.docx, .html, או .txt.`);
  }

  html = stripInvisible(html);
  const { wiredHtml, fields } = extractFields(html);
  const title = inferTitleFromHtml(html) || filename || 'New contract';
  return { html: wiredHtml, title, fields };
}

// Word inserts lots of invisible Unicode chars (BOM, LRM/RLM, ZWSP, soft
// hyphens, directional overrides) that render as ugly little boxes in fonts
// that don't implement them. Strip the ones we never want to see.
function stripInvisible(html) {
  return String(html)
    .replace(/\uFEFF/g, '')                    // BOM
    .replace(/[\u200B-\u200F]/g, '')           // ZWSP, ZWNJ, ZWJ, LRM, RLM
    .replace(/[\u202A-\u202E]/g, '')           // directional overrides
    .replace(/[\u2066-\u2069]/g, '')           // isolate controls
    .replace(/\u00AD/g, '')                    // soft hyphen
    .replace(/\u0000/g, '');                   // NULL
}

// Replace every detected placeholder with a span that the filler can
// target directly by field key.
function extractFields(html) {
  const fields   = [];
  const seenKeys = new Set();
  let auto = 0;
  let current = html;

  const register = (rawKey, labelOverride) => {
    let key = slugify(rawKey) || `field_${++auto}`;
    while (seenKeys.has(key)) key = key + '_2';
    seenKeys.add(key);
    fields.push({
      key,
      label:  (labelOverride || rawKey || key).trim(),
      group:  null,
      order:  fields.length,
      kind:   guessKind(labelOverride || rawKey),
    });
    return key;
  };

  // Pass 1: {{key}} or {{key:Label}}
  //  — {{signature}} is reserved: left as a literal marker so the renderer
  //    can swap it with the signature image at export time without it being
  //    treated as a fillable form field.
  current = current.replace(RE_DOUBLE, (match, inner) => {
    const [rawKey, ...labelParts] = inner.split(':');
    if (/^\s*signature\s*$/i.test(rawKey)) return '{{signature}}';
    const key = register(rawKey, labelParts.join(':') || rawKey);
    return fieldSpan(key);
  });

  // Pass 2: [key]  — skip matches inside existing spans we just emitted
  current = current.replace(RE_SQUARE, (match, inner) => {
    // Ignore things that look like HTML attribute chunks
    if (/["<>]/.test(inner)) return match;
    const key = register(inner);
    return fieldSpan(key);
  });

  // Pass 3: long underscores → auto fields
  current = current.replace(RE_LINE, () => {
    const key = register(`field_${++auto}`, `שדה ${auto}`);
    return fieldSpan(key);
  });

  // Group assignment: walk the HTML, whenever we cross an <h1>..<h4>, any
  // subsequent fields (by order) inherit that group name until the next heading.
  assignGroupsByHeading(current, fields);

  return { wiredHtml: current, fields };
}

function fieldSpan(key) {
  return `<span class="field" data-field="${key}">{{${key}}}</span>`;
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9_\u0590-\u05FF]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

function guessKind(label) {
  const s = String(label || '').toLowerCase();
  // Order matters: amount_words is more specific than amount
  if (/words|במילים|מילים/.test(s))                       return 'amount_words';
  if (/amount|sum|price|cost|fee|סכום|מחיר|תשלום/.test(s)) return 'amount';
  if (/date|תאריך/.test(s))                               return 'date';
  if (/email|אימייל|מייל/.test(s))                         return 'email';
  if (/phone|טלפון|נייד/.test(s))                          return 'phone';
  return 'text';
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// Cheap title inference: first <h1>, <h2>, or first non-empty <p>
function inferTitleFromHtml(html) {
  const h = html.match(/<(h[12])[^>]*>([^<]{3,100})<\/\1>/i);
  if (h) return h[2].trim();
  const p = html.match(/<p[^>]*>([^<]{3,100})<\/p>/i);
  return p ? p[1].trim() : null;
}

// Walk the HTML string; each time we hit a heading, record its text. Each
// emitted field span then gets tagged with the latest heading as its group.
function assignGroupsByHeading(html, fields) {
  const headingRe = /<(h[1-4])[^>]*>([\s\S]*?)<\/\1>/gi;
  const fieldRe   = /data-field="([^"]+)"/g;
  const byKey = new Map(fields.map(f => [f.key, f]));

  // Collect positions
  const marks = [];
  let m;
  while ((m = headingRe.exec(html)) !== null) {
    marks.push({ kind: 'h', at: m.index, text: stripHtml(m[2]).trim() });
  }
  while ((m = fieldRe.exec(html)) !== null) {
    marks.push({ kind: 'f', at: m.index, key: m[1] });
  }
  marks.sort((a, b) => a.at - b.at);

  let currentGroup = null;
  for (const mk of marks) {
    if (mk.kind === 'h') currentGroup = mk.text || null;
    else if (byKey.has(mk.key)) byKey.get(mk.key).group = currentGroup;
  }
}

function stripHtml(s) { return String(s || '').replace(/<[^>]+>/g, ''); }

// ── Render: inject values into the template HTML ──────────────────────────────
function renderTemplate(templateHtml, values, signatureDataUrl) {
  let html = String(templateHtml || '').replace(
    /<span class="field" data-field="([^"]+)">[^<]*<\/span>/g,
    (_, key) => {
      const v = values?.[key];
      return v == null || v === ''
        ? `<span class="field field-empty" data-field="${key}">________</span>`
        : `<span class="field field-filled" data-field="${key}">${escapeHtml(String(v))}</span>`;
    }
  );
  if (signatureDataUrl) {
    html = html.replace(/{{\s*signature\s*}}/gi,
      `<img src="${signatureDataUrl}" class="signature-img" alt="signature" style="max-width:240px;max-height:120px"/>`);
  }
  return html;
}

module.exports = { parseBuffer, renderTemplate, extractFields };
