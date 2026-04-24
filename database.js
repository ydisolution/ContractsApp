/**
 * database.js — sql.js backed SQLite, persisted to contracts.db on disk.
 *
 * Mirrors the proxy API used by better-sqlite3 (prepare().get/all/run, exec,
 * transaction) so business logic stays synchronous and easy to read.
 *
 * No workspaces, no user scoping — this is a single-user local tool.
 */

const initSqlJs = require('sql.js');
const fs   = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'contracts.db');

let _db = null;
let _dirty = false;

function persist() {
  if (!_db) return;
  fs.writeFileSync(DB_PATH, Buffer.from(_db.export()));
  _dirty = false;
}
setInterval(() => { if (_dirty) persist(); }, 2000);
process.on('exit',    () => { if (_dirty) persist(); });
process.on('SIGINT',  () => { persist(); process.exit(0); });
process.on('SIGTERM', () => { persist(); process.exit(0); });

function normaliseParams(args) {
  if (args.length === 0) return [];
  if (args.length === 1 && Array.isArray(args[0])) return args[0];
  return args;
}

class Statement {
  constructor(sql) { this._sql = sql; }
  get(...args) {
    const params = normaliseParams(args);
    let stmt;
    try {
      stmt = _db.prepare(this._sql);
      if (params.length) stmt.bind(params);
      return stmt.step() ? stmt.getAsObject() : undefined;
    } catch (e) { throw enhance(e, this._sql); }
    finally { if (stmt) stmt.free(); }
  }
  all(...args) {
    const params = normaliseParams(args);
    let stmt;
    try {
      stmt = _db.prepare(this._sql);
      if (params.length) stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } catch (e) { throw enhance(e, this._sql); }
    finally { if (stmt) stmt.free(); }
  }
  run(...args) {
    const params = normaliseParams(args);
    try {
      _db.run(this._sql, params.length ? params : undefined);
      const changes = _db.getRowsModified();
      const res = _db.exec('SELECT last_insert_rowid() AS id');
      const lastInsertRowid = res.length ? res[0].values[0][0] : 0;
      _dirty = true;
      return { changes, lastInsertRowid };
    } catch (e) { throw enhance(e, this._sql); }
  }
}

function enhance(e, sql) {
  e.message = `${e.message}\nSQL: ${sql.slice(0, 120)}`;
  return e;
}

const db = {
  prepare(sql) { return new Statement(sql); },
  exec(sql) { try { _db.exec(sql); _dirty = true; } catch (e) { throw enhance(e, sql); } },
  transaction(fn) {
    return (...args) => {
      _db.run('BEGIN');
      try {
        const r = fn(...args);
        _db.run('COMMIT');
        _dirty = true;
        return r;
      } catch (e) { try { _db.run('ROLLBACK'); } catch {} throw e; }
    };
  },
  async init() {
    const SQL = await initSqlJs();
    _db = fs.existsSync(DB_PATH)
      ? new SQL.Database(fs.readFileSync(DB_PATH))
      : new SQL.Database();
    applySchema();
    console.log('Database ready:', DB_PATH);
  },
};

function applySchema() {
  _db.exec(`
    CREATE TABLE IF NOT EXISTS contract_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      source_filename TEXT,
      html_body TEXT NOT NULL,
      fields_json TEXT NOT NULL,
      field_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_tpl_active ON contract_templates(deleted);

    CREATE TABLE IF NOT EXISTS contract_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL,
      title TEXT,
      values_json TEXT NOT NULL DEFAULT '{}',
      signature_data TEXT,
      saved_to_path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_draft_active ON contract_drafts(deleted);

    CREATE TABLE IF NOT EXISTS contract_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      save_folder TEXT DEFAULT '',
      default_signer_name TEXT DEFAULT ''
    );
    INSERT OR IGNORE INTO contract_settings (id) VALUES (1);
  `);
  persist();
}

module.exports = db;
