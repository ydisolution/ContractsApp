/**
 * contracts.js — DB layer for contract templates, drafts, and settings.
 * Single-user local tool, no scoping.
 */

const db = require('./database');

// ── Settings ──────────────────────────────────────────────────────────────────
function getSettings() {
  return db.prepare(`SELECT * FROM contract_settings WHERE id = 1`).get() || {};
}
function saveSettings({ save_folder, default_signer_name }) {
  const cur = getSettings();
  db.prepare(`
    UPDATE contract_settings SET save_folder = ?, default_signer_name = ? WHERE id = 1
  `).run(
    save_folder         ?? cur.save_folder         ?? '',
    default_signer_name ?? cur.default_signer_name ?? '',
  );
  return getSettings();
}

// ── Templates ────────────────────────────────────────────────────────────────
function listTemplates() {
  return db.prepare(
    `SELECT id, name, source_filename, field_count, created_at
     FROM contract_templates WHERE deleted = 0
     ORDER BY created_at DESC`
  ).all();
}
function getTemplate(id) {
  return db.prepare(
    `SELECT * FROM contract_templates WHERE id = ? AND deleted = 0`
  ).get(id);
}
function createTemplate({ name, source_filename, html_body, fields }) {
  const r = db.prepare(`
    INSERT INTO contract_templates
      (name, source_filename, html_body, fields_json, field_count)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    name, source_filename || null, html_body,
    JSON.stringify(fields || []), (fields || []).length
  );
  return getTemplate(r.lastInsertRowid);
}
function renameTemplate(id, name) {
  return db.prepare(`UPDATE contract_templates SET name = ? WHERE id = ?`).run(name, id).changes;
}
function deleteTemplate(id) {
  return db.prepare(`UPDATE contract_templates SET deleted = 1 WHERE id = ?`).run(id).changes;
}

// ── Drafts ───────────────────────────────────────────────────────────────────
function listDrafts() {
  return db.prepare(`
    SELECT d.id, d.template_id, d.title, d.saved_to_path, d.updated_at,
           t.name AS template_name
    FROM contract_drafts d
    LEFT JOIN contract_templates t ON t.id = d.template_id
    WHERE d.deleted = 0
    ORDER BY d.updated_at DESC
  `).all();
}
function getDraft(id) {
  return db.prepare(
    `SELECT * FROM contract_drafts WHERE id = ? AND deleted = 0`
  ).get(id);
}
function upsertDraft(draft) {
  const values = JSON.stringify(draft.values || {});
  if (draft.id) {
    db.prepare(`
      UPDATE contract_drafts
      SET title = ?, values_json = ?, signature_data = ?, saved_to_path = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      draft.title || null, values, draft.signature_data || null,
      draft.saved_to_path || null, draft.id
    );
    return getDraft(draft.id);
  }
  const r = db.prepare(`
    INSERT INTO contract_drafts
      (template_id, title, values_json, signature_data, saved_to_path)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    draft.template_id, draft.title || null, values,
    draft.signature_data || null, draft.saved_to_path || null
  );
  return getDraft(r.lastInsertRowid);
}
function deleteDraft(id) {
  return db.prepare(`UPDATE contract_drafts SET deleted = 1 WHERE id = ?`).run(id).changes;
}

module.exports = {
  getSettings, saveSettings,
  listTemplates, getTemplate, createTemplate, renameTemplate, deleteTemplate,
  listDrafts, getDraft, upsertDraft, deleteDraft,
};
