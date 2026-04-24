// ── API + tiny helpers ────────────────────────────────────────────────────────
async function api(url, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(url, opts);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || resp.statusText);
  }
  return resp.json();
}
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' ' +
         d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}
let _toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.remove('hidden');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add('hidden'), 2800);
}

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  tab: 'templates',
  currentTemplate: null,
};
const editorState = { values: {}, search: '', title: '', signature_data: null, draftId: null, _tplId: null };

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Handle ?openDraft=<path> — Windows file association lands here
  const qp = new URLSearchParams(window.location.search);
  const draftPath = qp.get('openDraft');
  if (draftPath) {
    history.replaceState({}, '', window.location.pathname);
    openLocalDraftFile(draftPath);
    return;
  }
  loadTemplates();
});

async function openLocalDraftFile(path) {
  try {
    const saved = await api('/api/drafts/open-file', 'POST', { path });
    await openDraft(saved.id);
    toast('הטיוטה נטענה מהקובץ');
  } catch (e) { toast('שגיאה: ' + e.message); }
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
  document.getElementById('tab-' + tab).style.display = '';
  if (tab === 'templates') loadTemplates();
  if (tab === 'drafts')    loadDrafts();
  if (tab === 'editor')    renderEditor();
}

// ── Templates list ────────────────────────────────────────────────────────────
async function loadTemplates() {
  const el = document.getElementById('templatesList');
  el.innerHTML = 'טוען...';
  try {
    const rows = await api('/api/templates');
    if (!rows.length) {
      el.innerHTML = `<div style="color:var(--text2);text-align:center;padding:40px">
        עדיין אין תבניות. לחץ "+ תבנית חדשה" למעלה כדי להעלות Word / HTML / טקסט.
      </div>`;
      return;
    }
    el.innerHTML = `<table class="data-table">
      <thead><tr><th>שם</th><th>מקור</th><th>שדות</th><th>נוצר</th><th></th></tr></thead>
      <tbody>${rows.map(r => `
        <tr>
          <td><strong>${esc(r.name)}</strong></td>
          <td style="color:var(--text2);font-size:12px">${esc(r.source_filename || '—')}</td>
          <td>${r.field_count}</td>
          <td style="color:var(--text2);font-size:12px">${fmtDate(r.created_at)}</td>
          <td>
            <button class="btn btn-primary btn-sm" onclick="openEditorForTemplate(${r.id})">✍️ ערוך</button>
            <button class="btn btn-ghost btn-sm" onclick="deleteTemplate(${r.id}, ${JSON.stringify(r.name).replace(/"/g, '&quot;')})" style="color:var(--red)">🗑</button>
          </td>
        </tr>`).join('')}</tbody></table>`;
  } catch (e) { el.innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
}

async function deleteTemplate(id, name) {
  if (!confirm(`למחוק את התבנית "${name}"?`)) return;
  await api(`/api/templates/${id}`, 'DELETE');
  loadTemplates();
}

// ── Drafts list + drag-drop ──────────────────────────────────────────────────
function wireDraftsDropZone() {
  const wrap = document.getElementById('tab-drafts');
  if (wrap._wired) return;
  wrap._wired = true;
  wrap.addEventListener('dragover', e => { e.preventDefault(); wrap.classList.add('drop-active'); });
  wrap.addEventListener('dragleave', () => wrap.classList.remove('drop-active'));
  wrap.addEventListener('drop', async e => {
    e.preventDefault(); wrap.classList.remove('drop-active');
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (!/\.(contract\.)?json$/i.test(file.name)) { toast('רק .json / .contract.json נתמכים'); return; }
    const fd = new FormData(); fd.append('file', file);
    try {
      const resp = await fetch('/api/drafts/import', { method: 'POST', body: fd });
      const j = await resp.json();
      if (!resp.ok) throw new Error(j.error || 'שגיאה');
      toast('✓ הטיוטה נטענה');
      if (j.id) openDraft(j.id);
    } catch (e) { toast('שגיאה: ' + e.message); }
  });
}

async function loadDrafts() {
  wireDraftsDropZone();
  const el = document.getElementById('draftsList');
  el.innerHTML = 'טוען...';
  try {
    const rows = await api('/api/drafts');
    const importCard = `<div style="border-top:1px solid var(--border);padding-top:16px;margin-top:16px">
      <h3 style="margin:0 0 8px">📂 טען מקובץ מקומי</h3>
      <div style="display:flex;gap:8px;align-items:center">
        <input type="file" id="importFile" accept=".json,.contract.json" />
        <button class="btn btn-primary btn-sm" onclick="importDraftFromPicker()">📥 טען</button>
      </div>
      <div class="hint">ניתן גם לגרור קובץ .contract.json לאזור הזה</div>
    </div>`;

    if (!rows.length) {
      el.innerHTML = `<div style="color:var(--text2);text-align:center;padding:40px">אין טיוטות עדיין. צור חוזה חדש ושמור טיוטה כדי שתופיע כאן.</div>${importCard}`;
      return;
    }
    el.innerHTML = `<table class="data-table">
      <thead><tr><th>כותרת</th><th>תבנית</th><th>עודכן</th><th>נשמר בדיסק</th><th></th></tr></thead>
      <tbody>${rows.map(d => `
        <tr>
          <td><strong>${esc(d.title || '(ללא שם)')}</strong></td>
          <td style="color:var(--text2);font-size:12px">${esc(d.template_name || '—')}</td>
          <td style="color:var(--text2);font-size:12px">${fmtDate(d.updated_at)}</td>
          <td style="color:var(--text2);font-size:11px;direction:ltr">${d.saved_to_path ? esc(d.saved_to_path) : '—'}</td>
          <td>
            <button class="btn btn-primary btn-sm" onclick="openDraft(${d.id})">✍️ ערוך</button>
            <button class="btn btn-ghost btn-sm" onclick="deleteDraft(${d.id}, ${JSON.stringify(d.title || '').replace(/"/g, '&quot;')})" style="color:var(--red)">🗑</button>
          </td>
        </tr>`).join('')}</tbody></table>${importCard}`;
  } catch (e) { el.innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
}

async function importDraftFromPicker() {
  const file = document.getElementById('importFile').files[0];
  if (!file) { toast('בחר קובץ'); return; }
  const fd = new FormData(); fd.append('file', file);
  try {
    const resp = await fetch('/api/drafts/import', { method: 'POST', body: fd });
    const j = await resp.json();
    if (!resp.ok) throw new Error(j.error || 'שגיאה');
    toast('✓ הטיוטה נטענה');
    if (j.id) openDraft(j.id);
  } catch (e) { toast('שגיאה: ' + e.message); }
}

async function deleteDraft(id, title) {
  if (!confirm(`למחוק את הטיוטה "${title || '(ללא שם)'}"?`)) return;
  await api(`/api/drafts/${id}`, 'DELETE');
  loadDrafts();
}

// ── Upload template ──────────────────────────────────────────────────────────
function openUploadTemplate() {
  document.getElementById('tplName').value  = '';
  document.getElementById('tplFile').value  = '';
  document.getElementById('tplPaste').value = '';
  document.getElementById('tplMsg').textContent = '';
  document.getElementById('tplMsg').className = 'msg';
  document.getElementById('uploadModal').classList.remove('hidden');
}
function closeUploadTemplate() { document.getElementById('uploadModal').classList.add('hidden'); }

async function submitUploadTemplate() {
  const name  = document.getElementById('tplName').value.trim();
  const file  = document.getElementById('tplFile').files[0];
  const paste = document.getElementById('tplPaste').value.trim();
  const msg   = document.getElementById('tplMsg');
  const btn   = document.getElementById('tplBtn');

  if (!file && !paste) { msg.textContent = 'העלה קובץ או הדבק טקסט'; msg.className = 'msg err'; return; }

  btn.disabled = true; btn.textContent = 'מנתח...';
  msg.textContent = ''; msg.className = 'msg';

  try {
    const fd = new FormData();
    if (file)  fd.append('file', file);
    if (paste) fd.append('html', paste);
    if (name)  fd.append('name', name);
    const resp = await fetch('/api/templates', { method: 'POST', body: fd });
    const j = await resp.json();
    if (!resp.ok) throw new Error(j.error || 'שגיאה');

    msg.textContent = `✓ התבנית נוצרה · ${j.field_count} שדות זוהו`;
    msg.className = 'msg ok';
    await loadTemplates();
    setTimeout(closeUploadTemplate, 1200);
  } catch (e) { msg.textContent = e.message; msg.className = 'msg err'; }
  finally     { btn.disabled = false; btn.textContent = 'העלה ונתח'; }
}

// ── Editor ────────────────────────────────────────────────────────────────────
async function openEditorForTemplate(templateId) {
  try {
    const tpl = await api(`/api/templates/${templateId}`);
    state.currentTemplate = tpl;
    editorState._tplId  = tpl.id;
    editorState.draftId = null;
    editorState.values  = {};
    editorState.title   = '';
    editorState.signature_data = null;
    document.getElementById('tabEditor').style.display = '';
    switchTab('editor');
  } catch (e) { toast('שגיאה: ' + e.message); }
}

async function openDraft(draftId) {
  try {
    const d = await api(`/api/drafts/${draftId}`);
    const tpl = await api(`/api/templates/${d.template_id}`);
    state.currentTemplate = tpl;
    editorState._tplId  = tpl.id;
    editorState.draftId = d.id;
    editorState.values  = d.values || {};
    editorState.title   = d.title || '';
    editorState.signature_data = d.signature_data || null;
    document.getElementById('tabEditor').style.display = '';
    switchTab('editor');
  } catch (e) { toast('שגיאה: ' + e.message); }
}

function renderEditor() {
  const root = document.getElementById('editorRoot');
  const tpl  = state.currentTemplate;
  if (!tpl) {
    root.innerHTML = '<div class="card" style="color:var(--text2);text-align:center;padding:40px">בחר תבנית מהטאב "📚 תבניות" כדי להתחיל</div>';
    return;
  }
  root.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div class="cc-editor-toolbar">
        <strong style="font-size:14px">✍️ ${esc(tpl.name)}</strong>
        <span style="color:var(--text2);font-size:12px">${tpl.fields.length} שדות · ${countFilled()}/${tpl.fields.length} מולאו</span>
        <div style="flex:1"></div>
        <input type="text" id="titleInput" placeholder="שם לטיוטה (למשל שם לקוח)" style="min-width:200px" oninput="editorState.title=this.value" />
        <input type="search" id="fieldSearch" placeholder="🔍 חפש שדה..." oninput="editorState.search=this.value.toLowerCase();renderEditor()" />
        <button class="btn btn-primary btn-sm" onclick="saveDraft()">💾 שמור טיוטה</button>
        <button class="btn btn-ghost btn-sm" onclick="exportPdf()">📄 ייצא PDF</button>
        <span id="saveMsg" style="font-size:12px"></span>
      </div>
    </div>
    <div class="cc-editor">
      <div class="cc-fields-pane">
        ${renderFieldsPane()}
        ${renderSignaturePane()}
      </div>
      <div class="cc-preview-pane" id="preview">${livePreviewHtml()}</div>
    </div>`;

  const s = document.getElementById('fieldSearch');
  if (s) s.value = editorState.search;
  const t = document.getElementById('titleInput');
  if (t) t.value = editorState.title;

  initSignatureCanvas();
}

function countFilled() {
  const tpl = state.currentTemplate; if (!tpl) return 0;
  return tpl.fields.filter(f => {
    const v = editorState.values[f.key];
    return v != null && v !== '';
  }).length;
}

function renderFieldsPane() {
  const tpl = state.currentTemplate;
  const q   = editorState.search;
  const groups = new Map();
  for (const f of tpl.fields) {
    const key = f.group || 'שדות';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  const parts = [];
  for (const [group, list] of groups.entries()) {
    const visible = q
      ? list.filter(f => (f.label || '').toLowerCase().includes(q) || (f.key || '').toLowerCase().includes(q))
      : list;
    if (!visible.length) continue;
    parts.push(`<div class="cc-group-title">${esc(group)}</div>`);
    for (const f of visible) parts.push(renderFieldRow(f));
  }
  return parts.join('') || '<div style="color:var(--text2);text-align:center;padding:20px">לא נמצאו שדות</div>';
}

function renderFieldRow(f) {
  const v = editorState.values[f.key] ?? '';
  const kindChip = f.kind !== 'text' ? `<span class="kind-chip">${esc(f.kind)}</span>` : '';
  let inputHtml;
  if (f.kind === 'amount_words') {
    inputHtml = `<input type="text" class="amount-words" data-field="${esc(f.key)}" value="${esc(v)}" placeholder="הזן סכום — יומר למילים"
                 oninput="onAmountWords('${esc(f.key)}', this)" onblur="onBlurAmountWords('${esc(f.key)}')" />`;
  } else if (f.kind === 'date') {
    inputHtml = `<input type="date" data-field="${esc(f.key)}" value="${esc(v)}" oninput="onField('${esc(f.key)}', this.value)" />`;
  } else if (f.kind === 'amount') {
    inputHtml = `<input type="text" inputmode="decimal" data-field="${esc(f.key)}" value="${esc(v)}" placeholder="125000" oninput="onField('${esc(f.key)}', this.value)" />`;
  } else if (f.kind === 'email') {
    inputHtml = `<input type="email" data-field="${esc(f.key)}" value="${esc(v)}" oninput="onField('${esc(f.key)}', this.value)" />`;
  } else if (f.kind === 'phone') {
    inputHtml = `<input type="tel" dir="ltr" data-field="${esc(f.key)}" value="${esc(v)}" oninput="onField('${esc(f.key)}', this.value)" />`;
  } else {
    inputHtml = `<input type="text" data-field="${esc(f.key)}" value="${esc(v)}" oninput="onField('${esc(f.key)}', this.value)" />`;
  }
  return `<div class="cc-field-row"><label><span>${esc(f.label)}</span>${kindChip}</label>${inputHtml}</div>`;
}

let _prevTimer = null;
function onField(key, value) {
  editorState.values[key] = value;
  schedulePreview();
}
function onAmountWords(key, el) {
  editorState.values[key + '__raw'] = el.value;
  editorState.values[key] = el.value;
  schedulePreview();
}
function onBlurAmountWords(key) {
  const raw = editorState.values[key + '__raw'] ?? editorState.values[key];
  if (!raw) return;
  const words = window.numberToWords(raw, true);
  if (!words) return;
  editorState.values[key] = words;
  const input = document.querySelector(`.cc-fields-pane input[data-field="${key}"]`);
  if (input) input.value = words;
  schedulePreview();
}
function schedulePreview() {
  clearTimeout(_prevTimer);
  _prevTimer = setTimeout(() => {
    const el = document.getElementById('preview');
    if (el) el.innerHTML = livePreviewHtml();
  }, 80);
}
function livePreviewHtml() {
  const tpl = state.currentTemplate; if (!tpl) return '';
  let html = tpl.html_body.replace(
    /<span class="field" data-field="([^"]+)">[^<]*<\/span>/g,
    (_, key) => {
      const v = editorState.values[key];
      if (v == null || v === '') return `<span class="field field-empty" data-field="${key}">________</span>`;
      return `<span class="field field-filled" data-field="${key}">${esc(String(v))}</span>`;
    }
  );
  if (editorState.signature_data) {
    html = html.replace(/\{\{\s*signature\s*\}\}/gi,
      `<img src="${editorState.signature_data}" alt="signature" style="max-width:240px;max-height:100px;background:#fff;padding:4px;border:1px solid #e5e7eb;border-radius:4px"/>`);
  } else {
    html = html.replace(/\{\{\s*signature\s*\}\}/gi,
      '<span style="border-bottom:1px solid #9ca3af;display:inline-block;width:180px;height:1em">&nbsp;</span>');
  }
  return html;
}

// ── Signature canvas ──────────────────────────────────────────────────────────
function renderSignaturePane() {
  const has = !!editorState.signature_data;
  return `
    <div class="cc-group-title">חתימה</div>
    <div class="sig-box ${has ? 'has-drawing' : ''}" id="sigBox">
      <canvas id="sigCanvas"></canvas>
      ${has ? '' : '<div class="sig-box-placeholder">חתום כאן (גרור עם העכבר)</div>'}
    </div>
    <div class="sig-actions">
      <button class="btn btn-ghost btn-sm" onclick="clearSignature()">🧹 נקה</button>
      ${has ? `<div class="sig-preview" style="margin-inline-start:auto"><img src="${editorState.signature_data}" alt="signature"/></div>` : ''}
    </div>
    <div class="hint">שם ה-placeholder בתבנית: <code>{{signature}}</code>. גם יצוא ה-PDF ישתמש בחתימה הזו.</div>`;
}

function initSignatureCanvas() {
  const canvas = document.getElementById('sigCanvas');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 400, h = 180;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.lineWidth = 2.2; ctx.strokeStyle = '#111';
  if (editorState.signature_data) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, w, h);
    img.src = editorState.signature_data;
  }

  let drawing = false, last = null;
  const toPoint = e => {
    const rect = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  };
  const start = e => { e.preventDefault(); drawing = true; last = toPoint(e); };
  const move  = e => {
    if (!drawing) return; e.preventDefault();
    const p = toPoint(e);
    ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last = p;
  };
  const end = () => {
    if (!drawing) return; drawing = false;
    editorState.signature_data = canvas.toDataURL('image/png');
    document.getElementById('sigBox').classList.add('has-drawing');
    schedulePreview();
  };
  canvas.onmousedown = start;  canvas.onmousemove = move;  canvas.onmouseup = end;  canvas.onmouseleave = end;
  canvas.ontouchstart = start; canvas.ontouchmove = move;  canvas.ontouchend = end;
}

function clearSignature() {
  editorState.signature_data = null;
  const c = document.getElementById('sigCanvas');
  if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
  const box = document.getElementById('sigBox'); if (box) box.classList.remove('has-drawing');
  renderEditor();
}

// ── Save draft + export ──────────────────────────────────────────────────────
async function saveDraft() {
  const msg = document.getElementById('saveMsg');
  const tpl = state.currentTemplate; if (!tpl) return;
  try {
    const clean = {};
    for (const [k, v] of Object.entries(editorState.values)) {
      if (!k.endsWith('__raw')) clean[k] = v;
    }
    const saved = await api('/api/drafts', 'POST', {
      id:             editorState.draftId || null,
      template_id:    tpl.id,
      title:          (editorState.title || '').trim() || null,
      values:         clean,
      signature_data: editorState.signature_data || null,
    });
    editorState.draftId = saved.id;
    msg.textContent = saved.saved_to_path ? `✓ נשמר · ${saved.saved_to_path}` : '✓ נשמר (ללא תיקיה מקומית — הגדר ב-⚙️)';
    msg.style.color = 'var(--accent)';
    setTimeout(() => { msg.textContent = ''; }, 4000);
  } catch (e) { msg.textContent = '❌ ' + e.message; msg.style.color = 'var(--red)'; }
}

async function exportPdf() {
  const msg = document.getElementById('saveMsg');
  if (!editorState.draftId) { await saveDraft(); if (!editorState.draftId) return; }
  msg.textContent = '🖨 מייצר PDF...'; msg.style.color = 'var(--text2)';
  try {
    const r = await api(`/api/drafts/${editorState.draftId}/export`, 'POST');
    const byteChars = atob(r.pdf_base64);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = r.filename; a.click();
    URL.revokeObjectURL(url);
    msg.textContent = r.saved_to_path ? `✓ יוצא · ${r.saved_to_path}` : '✓ יוצא (הורדה בלבד — הגדר תיקיית שמירה)';
    msg.style.color = 'var(--accent)';
    setTimeout(() => { msg.textContent = ''; }, 5000);
  } catch (e) { msg.textContent = '❌ ' + e.message; msg.style.color = 'var(--red)'; }
}

// ── Settings ──────────────────────────────────────────────────────────────────
async function openSettings() {
  try {
    const s = await api('/api/settings');
    document.getElementById('stSaveFolder').value = s.save_folder || '';
    document.getElementById('stSignerName').value = s.default_signer_name || '';
    document.getElementById('stMsg').textContent = '';
    document.getElementById('stMsg').className = 'msg';
    document.getElementById('settingsModal').classList.remove('hidden');
  } catch (e) { toast('שגיאה: ' + e.message); }
}
function closeSettings() { document.getElementById('settingsModal').classList.add('hidden'); }
async function saveSettings() {
  const msg = document.getElementById('stMsg');
  try {
    await api('/api/settings', 'PUT', {
      save_folder:         document.getElementById('stSaveFolder').value.trim(),
      default_signer_name: document.getElementById('stSignerName').value.trim(),
    });
    msg.textContent = '✓ נשמר'; msg.className = 'msg ok';
    setTimeout(closeSettings, 800);
  } catch (e) { msg.textContent = '❌ ' + e.message; msg.className = 'msg err'; }
}
