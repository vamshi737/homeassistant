// db.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(process.cwd(), 'homebot.db');
let db;

// ---------- small helpers ----------
function open() {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(DB_PATH, (err) => (err ? reject(err) : resolve()));
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

// ---- photo MVP: ensure extra columns exist (safe to run every start) ----
async function ensurePhotoMvpColumns(db) {
  const cols = await all(`PRAGMA table_info(items);`);
  const has = (name) => cols.some((c) => c.name === name);

  if (!has('image_path'))  await run(`ALTER TABLE items ADD COLUMN image_path TEXT;`);
  if (!has('barcode'))     await run(`ALTER TABLE items ADD COLUMN barcode TEXT;`);
  if (!has('attributes'))  await run(`ALTER TABLE items ADD COLUMN attributes TEXT;`); // JSON string
  if (!has('confidence'))  await run(`ALTER TABLE items ADD COLUMN confidence REAL;`);
}
// ------------------------------------------------------------------------

// One-time DB init
async function init() {
  await open();
  await run(`PRAGMA journal_mode=WAL;`);

  // NOTE: This CREATE only runs on a fresh DB.
  // We include the new columns so new installs get everything in one shot.
  await run(`
    CREATE TABLE IF NOT EXISTS items (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     TEXT NOT NULL,
      name        TEXT NOT NULL,
      category    TEXT,
      size        TEXT,
      qty         INTEGER DEFAULT 0,
      location    TEXT,
      brand       TEXT,
      price       REAL,
      photo_url   TEXT,            -- external URL if you use one
      notes       TEXT,

      -- new for photo MVP
      image_path  TEXT,            -- local saved file path (uploads/xyz.jpg)
      barcode     TEXT,
      attributes  TEXT,            -- JSON string with extra OCR info
      confidence  REAL,            -- 0..100 simple score

      updated_at  TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, name)
    );
  `);

  // Indexes
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_items_user_name ON items(user_id, name);`);
  await run(`CREATE INDEX IF NOT EXISTS idx_items_user_category ON items(user_id, category);`);
  await run(`CREATE INDEX IF NOT EXISTS idx_items_user_location ON items(user_id, location);`);
  await run(`CREATE INDEX IF NOT EXISTS idx_items_user_brand    ON items(user_id, brand);`);

  // If table already existed, make sure new columns are present
  await ensurePhotoMvpColumns(db);
}

module.exports = { init, run, get, all };
