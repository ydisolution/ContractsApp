/**
 * contractPdf.js — render a filled contract to PDF via Puppeteer.
 *
 * Reuses the Chromium that whatsapp-web.js already has installed —
 * no extra download, no extra dependency.
 */

const puppeteer = require('puppeteer');
const { renderTemplate } = require('./contractParser');

// Shared browser — cold start is ~1s so we keep one alive for the process.
// Launched lazily on first PDF request.
let _browser = null;
async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser;
  _browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  return _browser;
}

function buildPageHtml(templateHtml, values, signatureDataUrl, title) {
  const inner = renderTemplate(templateHtml, values, signatureDataUrl);
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeAttr(title || 'Contract')}</title>
<style>
  @page { size: A4; margin: 20mm 18mm; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #111; line-height: 1.55; font-size: 12.5pt; }
  h1,h2,h3 { color: #111; }
  .field.field-empty { background: #fef3c7; padding: 0 3px; border-radius: 2px; }
  .field.field-filled { background: transparent; }
  .signature-img { max-width: 240px; max-height: 100px; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #d1d5db; padding: 6px 10px; }
  p { margin: 0.6em 0; }
</style>
</head><body>${inner}</body></html>`;
}

function escapeAttr(s) { return String(s || '').replace(/"/g, '&quot;'); }

async function renderPdf({ templateHtml, values, signatureDataUrl, title }) {
  const html = buildPageHtml(templateHtml, values, signatureDataUrl, title);
  const browser = await getBrowser();
  const page    = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    const buf = await page.pdf({
      format:          'A4',
      printBackground: true,
      margin:          { top: '20mm', right: '18mm', bottom: '20mm', left: '18mm' },
    });
    return buf;
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { renderPdf };
