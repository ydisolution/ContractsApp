/**
 * server.js — Contracts-App
 *
 * Single-user local tool. No auth, no sessions, no workspace scoping.
 * Port 3100 by default (WA-agent sibling runs on 3000).
 */

const express = require('express');
const cors    = require('cors');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const db              = require('./database');
const contracts       = require('./contracts');
const contractParser  = require('./contractParser');
const contractPdf     = require('./contractPdf');

const PORT = process.env.PORT || 3100;

const app    = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true, lastModified: true,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));

// Tiny status endpoint for smoke tests
app.get('/api/status', (_, res) => res.json({ ok: true, uptime: process.uptime() }));

// ─── Settings ─────────────────────────────────────────────────────────────────
app.get('/api/settings', (_, res) => res.json(contracts.getSettings()));
app.put('/api/settings', (req, res) => res.json(contracts.saveSettings(req.body || {})));

// ─── Templates ────────────────────────────────────────────────────────────────
app.get('/api/templates', (_, res) => res.json(contracts.listTemplates()));

app.get('/api/templates/:id', (req, res) => {
  const tpl = contracts.getTemplate(parseInt(req.params.id));
  if (!tpl) return res.status(404).json({ error: 'Not found' });
  res.json({ ...tpl, fields: JSON.parse(tpl.fields_json || '[]') });
});

app.post('/api/templates', upload.single('file'), async (req, res) => {
  let buffer = req.file?.buffer;
  let filename = req.file?.originalname;
  const pasted = req.body.html;
  if (!buffer && pasted) {
    buffer = Buffer.from(pasted, 'utf8');
    filename = (req.body.name || 'pasted') + '.html';
  }
  if (!buffer) return res.status(400).json({ error: 'No file and no html pasted' });

  // multer's originalname is latin1-decoded; restore Hebrew if mojibake pattern is present
  const cleanName = filename && /[×Ã]/.test(filename)
    ? Buffer.from(filename, 'latin1').toString('utf8')
    : filename;

  try {
    const parsed = await contractParser.parseBuffer(buffer, cleanName);
    const name   = (req.body.name || parsed.title || cleanName || 'Untitled').trim();
    const tpl    = contracts.createTemplate({
      name, source_filename: cleanName,
      html_body: parsed.html, fields: parsed.fields,
    });
    res.json({ ...tpl, fields: JSON.parse(tpl.fields_json || '[]') });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/templates/:id', (req, res) => {
  const n = contracts.renameTemplate(parseInt(req.params.id), req.body.name);
  res.json({ ok: !!n });
});

app.delete('/api/templates/:id', (req, res) => {
  contracts.deleteTemplate(parseInt(req.params.id));
  res.json({ ok: true });
});

// ─── Drafts ───────────────────────────────────────────────────────────────────
app.get('/api/drafts', (_, res) => res.json(contracts.listDrafts()));

app.get('/api/drafts/:id', (req, res) => {
  const d = contracts.getDraft(parseInt(req.params.id));
  if (!d) return res.status(404).json({ error: 'Not found' });
  res.json({ ...d, values: JSON.parse(d.values_json || '{}') });
});

app.post('/api/drafts', (req, res) => {
  const saved = contracts.upsertDraft({
    id:              req.body.id || null,
    template_id:     req.body.template_id,
    title:           req.body.title,
    values:          req.body.values || {},
    signature_data:  req.body.signature_data || null,
    saved_to_path:   req.body.saved_to_path || null,
  });

  // Mirror to disk if save_folder is configured
  const settings = contracts.getSettings();
  let writtenPath = null;
  if (settings.save_folder && req.body.writeLocal !== false) {
    try {
      if (!fs.existsSync(settings.save_folder)) fs.mkdirSync(settings.save_folder, { recursive: true });
      const safe = String(saved.title || `draft-${saved.id}`).replace(/[\/\\:*?"<>|]+/g, '_').slice(0, 80);
      writtenPath = path.join(settings.save_folder, `${safe}.contract.json`);
      fs.writeFileSync(writtenPath, JSON.stringify({
        version: 1,
        draft_id:    saved.id,
        template_id: saved.template_id,
        title:       saved.title,
        values:      JSON.parse(saved.values_json || '{}'),
        signature_data: saved.signature_data,
        saved_at: new Date().toISOString(),
      }, null, 2), 'utf8');
      contracts.upsertDraft({
        id: saved.id, template_id: saved.template_id, title: saved.title,
        values: JSON.parse(saved.values_json || '{}'),
        signature_data: saved.signature_data, saved_to_path: writtenPath,
      });
    } catch (e) { console.warn('[Contracts] local write failed:', e.message); }
  }
  res.json({ ...saved, saved_to_path: writtenPath || saved.saved_to_path, values: JSON.parse(saved.values_json || '{}') });
});

app.delete('/api/drafts/:id', (req, res) => {
  contracts.deleteDraft(parseInt(req.params.id));
  res.json({ ok: true });
});

// Import by uploaded .contract.json (drag-drop + file picker)
app.post('/api/drafts/import', upload.single('file'), (req, res) => {
  let json;
  try {
    if (req.file?.buffer)   json = JSON.parse(req.file.buffer.toString('utf8'));
    else if (req.body.json) json = typeof req.body.json === 'string' ? JSON.parse(req.body.json) : req.body.json;
    else                    return res.status(400).json({ error: 'No file or json body' });
  } catch (e) { return res.status(400).json({ error: 'Invalid JSON: ' + e.message }); }

  const tpl = contracts.getTemplate(parseInt(json.template_id));
  if (!tpl) return res.status(400).json({ error: 'Template not found — re-import the template first' });

  const saved = contracts.upsertDraft({
    template_id:    tpl.id,
    title:          json.title || null,
    values:         json.values || {},
    signature_data: json.signature_data || null,
  });
  res.json({ ...saved, values: JSON.parse(saved.values_json || '{}') });
});

// Import by absolute path (used when Windows opens a .contract.json with ?openDraft=)
app.post('/api/drafts/open-file', (req, res) => {
  const filePath = String(req.body.path || '').trim();
  if (!filePath) return res.status(400).json({ error: 'path required' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });
  if (!/\.(contract\.)?json$/i.test(filePath)) return res.status(400).json({ error: 'Must be a .json / .contract.json file' });

  let json;
  try       { json = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (e) { return res.status(400).json({ error: 'Invalid JSON: ' + e.message }); }

  const tpl = contracts.getTemplate(parseInt(json.template_id));
  if (!tpl) return res.status(400).json({ error: 'Template not found' });

  const saved = contracts.upsertDraft({
    template_id:    tpl.id,
    title:          json.title || path.basename(filePath).replace(/\.(contract\.)?json$/i, ''),
    values:         json.values || {},
    signature_data: json.signature_data || null,
    saved_to_path:  filePath,
  });
  res.json({ ...saved, values: JSON.parse(saved.values_json || '{}') });
});

// Render the draft to PDF. With ?inline=1 returns bytes directly; otherwise
// returns base64 + also writes a copy to the configured save_folder.
app.post('/api/drafts/:id/export', async (req, res) => {
  const d = contracts.getDraft(parseInt(req.params.id));
  if (!d) return res.status(404).json({ error: 'Draft not found' });
  const tpl = contracts.getTemplate(d.template_id);
  if (!tpl) return res.status(404).json({ error: 'Template not found' });

  const values = JSON.parse(d.values_json || '{}');
  let buf;
  try {
    buf = await contractPdf.renderPdf({
      templateHtml:     tpl.html_body,
      values,
      signatureDataUrl: d.signature_data,
      title:            d.title || tpl.name,
    });
  } catch (e) { return res.status(500).json({ error: 'PDF render failed: ' + e.message }); }

  if (req.query.inline === '1') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent((d.title || tpl.name) + '.pdf')}"`);
    return res.send(buf);
  }

  const settings = contracts.getSettings();
  let written = null;
  if (settings.save_folder) {
    try {
      if (!fs.existsSync(settings.save_folder)) fs.mkdirSync(settings.save_folder, { recursive: true });
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      const safe  = String(d.title || tpl.name || `contract-${d.id}`).replace(/[\/\\:*?"<>|]+/g, '_').slice(0, 80);
      written = path.join(settings.save_folder, `${safe}-${stamp}.pdf`);
      fs.writeFileSync(written, buf);
    } catch (e) { console.warn('[Contracts] pdf write failed:', e.message); }
  }
  res.json({
    ok: true,
    saved_to_path: written,
    pdf_base64:    buf.toString('base64'),
    filename:      (d.title || tpl.name) + '.pdf',
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
(async () => {
  await db.init();
  app.listen(PORT, () => {
    console.log(`\n📄 Contracts-App running at http://localhost:${PORT}\n`);
  });
})();
