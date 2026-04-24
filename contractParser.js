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
  let html;
  if (lower.endsWith('.docx')) {
    const r = await mammoth.convertToHtml({ buffer });
    html = r.value;
  } else if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    html = buffer.toString('utf8');
  } else {
    // Plain text — wrap each line / paragraph
    const text = buffer.toString('utf8');
    html = text
      .split(/\n{2,}/)
      .map(p => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`)
      .join('\n');
  }

  const { wiredHtml, fields } = extractFields(html);
  const title = inferTitleFromHtml(html) || filename || 'New contract';
  return { html: wiredHtml, title, fields };
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
