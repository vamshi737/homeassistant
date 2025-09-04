// db.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(process.cwd(), 'homebot.db');
let db;

function open() {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(DB_PATH, err => (err ? reject(err) : resolve()));
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

async function init() {
  await open();
  await run(`PRAGMA journal_mode=WAL;`);
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
      photo_url   TEXT,
      notes       TEXT,
      updated_at  TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, name)
    );
  `);

  // Secondary indexes (help list/find)
  await run(`CREATE INDEX IF NOT EXISTS idx_items_user_category ON items(user_id, category);`);
  await run(`CREATE INDEX IF NOT EXISTS idx_items_user_location ON items(user_id, location);`);
  await run(`CREATE INDEX IF NOT EXISTS idx_items_user_brand    ON items(user_id, brand);`);
}

module.exports = { init, run, get, all };
