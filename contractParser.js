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

const RE_DOUBLE  = /\{\{\s*([^\s}][^}]*?)\s*\}\}/g;     // {{field}} or {{field:Label}}
const RE_SQUARE  = /\[\s*([A-Za-z_\u0590-\u05FF][^\]\n]{0,60})\s*\]/g;
const RE_LINE    = /_{4,}/g;
const RE_EMPTY_PAREN = /\(\s{2,}\)/g;                    // "(  )" two or more spaces
const RE_CHECKBOX = /[□☐]|\[\s*[xXvV✓ ]?\s*\]/g;          // □ ☐ [ ] [X] [V]
const RE_DATE    = /_{1,3}\s*\/\s*_{1,3}(?:\s*\/\s*_{1,4})?/g;    // __/__/__  or __/__/____

// ── Hebrew ↔ English label dictionary ────────────────────────────────────────
// Bidirectional; keys are lowercase-trimmed. Used both to translate a label
// from one language to the other and to clean up auto-generated labels.
const LABEL_DICT = (() => {
  const pairs = [
    ['name',                  'שם'],
    ['full name',             'שם מלא'],
    ['first name',            'שם פרטי'],
    ['last name',             'שם משפחה'],
    ['client',                'לקוח'],
    ['client name',           'שם הלקוח'],
    ['seller',                'מוכר'],
    ['buyer',                 'קונה'],
    ['owner',                 'בעלים'],
    ['party',                 'צד'],
    ['representative',        'נציג'],
    ['address',               'כתובת'],
    ['city',                  'עיר'],
    ['state',                 'מדינה'],
    ['country',               'ארץ'],
    ['zip',                   'מיקוד'],
    ['zip code',              'מיקוד'],
    ['phone',                 'טלפון'],
    ['mobile',                'נייד'],
    ['cell',                  'נייד'],
    ['telephone',             'טלפון'],
    ['email',                 'אימייל'],
    ['id',                    'ת.ז.'],
    ['id number',             'תעודת זהות'],
    ['passport',              'דרכון'],
    ['date',                  'תאריך'],
    ['date of birth',         'תאריך לידה'],
    ['dob',                   'תאריך לידה'],
    ['amount',                'סכום'],
    ['sum',                   'סכום'],
    ['price',                 'מחיר'],
    ['cost',                  'עלות'],
    ['fee',                   'תשלום'],
    ['total',                 'סה״כ'],
    ['down payment',          'מקדמה'],
    ['deposit',               'פיקדון'],
    ['amount in words',       'סכום במילים'],
    ['signature',             'חתימה'],
    ['witness',               'עד'],
    ['witnesses',             'עדים'],
    ['property',              'נכס'],
    ['premises',              'נכס / מקרקעין'],
    ['apartment',             'דירה'],
    ['house',                 'בית'],
    ['building',              'בניין'],
    ['land',                  'קרקע'],
    ['lot',                   'חלקה'],
    ['block',                 'גוש'],
    ['room',                  'חדר'],
    ['sales price',           'מחיר מכירה'],
    ['purchase price',        'מחיר רכישה'],
    ['list price',            'מחיר מבוקש'],
    ['purchaser',             'רוכש'],
    ['vendor',                'מוכר'],
    ['grantor',               'המעביר'],
    ['grantee',               'הנעבר'],
    ['escrow',                'נאמנות'],
    ['closing',               'סגירה'],
    ['mortgage',              'משכנתא'],
    ['earnest money',         'דמי רצינות'],
    ['contingency',           'תנאי'],
    ['title',                 'בעלות'],
    ['deed',                  'שטר'],
    ['lease',                 'חוזה שכירות'],
    ['rent',                  'שכר דירה'],
    ['notes',                 'הערות'],
    ['note',                  'הערה'],
    ['company',               'חברה'],
    ['corporation',           'תאגיד'],
    ['tax id',                'ח.פ.'],
    ['vat',                   'מע״מ'],
    ['bank',                  'בנק'],
    ['account',               'חשבון'],
    ['account number',        'מספר חשבון'],
    ['branch',                'סניף'],
    ['iban',                  'IBAN'],
    ['subject',               'נושא'],
    ['term',                  'תקופה'],
    ['start date',            'תאריך התחלה'],
    ['end date',              'תאריך סיום'],
    ['closing date',          'תאריך סגירה'],
    ['delivery date',         'תאריך מסירה'],
    ['initials',              'ראשי תיבות'],
  ];
  const enToHe = new Map(), heToEn = new Map();
  for (const [en, he] of pairs) {
    enToHe.set(en.toLowerCase(), he);
    heToEn.set(he, en[0].toUpperCase() + en.slice(1));
  }
  return { enToHe, heToEn };
})();

function translateLabel(raw) {
  const s = String(raw || '').trim();
  if (!s) return { en: '', he: '' };
  // Pure Hebrew? → look up English
  if (/^[^A-Za-z]+$/.test(s)) {
    return { he: s, en: LABEL_DICT.heToEn.get(s) || '' };
  }
  // Pure ASCII? → look up Hebrew
  const lower = s.toLowerCase().replace(/[_/]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^[A-Za-z0-9 _/]+$/.test(s)) {
    return { en: titleCase(lower), he: LABEL_DICT.enToHe.get(lower) || '' };
  }
  // Mixed — return as-is, no translation
  return { en: s, he: '' };
}

function titleCase(s) {
  return s.split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
}

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
    const rawLabel = (labelOverride || rawKey || key).trim();
    const { en, he } = translateLabel(rawLabel);
    fields.push({
      key,
      label:    rawLabel,           // original (for legacy code paths)
      label_en: en || rawLabel,
      label_he: he || '',
      group:    null,
      order:    fields.length,
      kind:     guessKind(rawLabel),
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
    if (/["<>]/.test(inner)) return match;
    // Ignore short checkbox-like markers — Pass 4 handles them
    if (/^\s*[xXvV✓ ]?\s*$/.test(inner)) return match;
    const key = register(inner);
    return fieldSpan(key);
  });

  // Pass 3: date patterns like __/__/__ or __/__/____ → single date field
  current = current.replace(RE_DATE, () => {
    const idx = ++auto;
    const key = register(`date_${idx}`, `Date ${idx}`);
    const f = fields[fields.length - 1];
    f.kind = 'date'; f.label_he = f.label_he || 'תאריך';
    return fieldSpan(key);
  });

  // Pass 3b: "block-end labels" — an ALL-CAPS or Hebrew label that ends a
  // block element with no value after the colon. These are common section
  // headings in real-estate contracts (PREMISES:, PURCHASER:, SALES PRICE: $)
  // and need to become fillable. The label must be uppercase Latin or pure
  // Hebrew so we don't false-match ordinary body text like "as follows:".
  //
  //   <p>PREMISES:</p>                  → <p>PREMISES: <span class="field"…/></p>
  //   <p>SALES PRICE: $</p>             → kind=amount, span placed after the $
  //   <p><strong>PURCHASER</strong>:</p> → label captured even when bolded
  current = current.replace(
    /((?:<\/?(?:strong|b|em|u|span|i)[^>]*>)*)([A-Z][A-Z0-9 &/\.\-'"]{1,40}[A-Z]|[\u0590-\u05FF][\u0590-\u05FF0-9 &/\.\-'"]{1,40}[\u0590-\u05FF])((?:<\/?(?:strong|b|em|u|span|i)[^>]*>)*)\s*[:：]\s*([\$£€₪]?)\s*(<\/(?:p|h[1-6]|li|td|div)>)/g,
    (match, pre, label, post, currency, close) => {
      const cleanLabel = label.replace(/\s+/g, ' ').trim();
      // Skip junk like single repeated letters
      if (cleanLabel.length < 3) return match;
      const key = register(slugify(cleanLabel) || `field_${++auto}`, cleanLabel);
      if (currency.trim()) fields[fields.length - 1].kind = 'amount';
      return pre + label + post + ': ' + (currency || '') + ' ' + fieldSpan(key) + close;
    }
  );

  // Pass 4: label-before-underscore. Scan for sequences of "label: _______"
  //   or "label _______" or "label: $_______" (currency-prefixed numbers)
  //   and use the label as the field name. Works for English and Hebrew.
  current = current.replace(
    /([A-Za-z\u0590-\u05FF][A-Za-z\u0590-\u05FF \.\-'"]{1,40}?)[\s:：]{1,3}([\$£€₪]?\s*)(_{4,})/g,
    (match, label, currency, underscores) => {
      const key = register(slugify(label) || `field_${++auto}`, label.trim());
      // Mark amount fields when a currency sign is present
      if (currency.trim()) fields[fields.length - 1].kind = 'amount';
      return match.slice(0, match.length - underscores.length) + fieldSpan(key);
    }
  );

  // Pass 5: remaining long underscores → generic auto fields
  current = current.replace(RE_LINE, () => {
    const idx = ++auto;
    const key = register(`field_${idx}`, `Field ${idx}`);
    return fieldSpan(key);
  });

  // Pass 6: empty parentheses "(   )" → short text field
  current = current.replace(RE_EMPTY_PAREN, () => {
    const idx = ++auto;
    const key = register(`field_${idx}`, `Field ${idx}`);
    return '(' + fieldSpan(key) + ')';
  });

  // Pass 7: checkbox markers → boolean-ish field
  current = current.replace(RE_CHECKBOX, () => {
    const idx = ++auto;
    const key = register(`check_${idx}`, `Checkbox ${idx}`);
    const f = fields[fields.length - 1];
    f.kind = 'checkbox';
    return fieldSpan(key);
  });

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
