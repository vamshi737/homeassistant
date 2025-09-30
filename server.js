// server.js
const express = require('express');
const axios = require('axios');
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const { init, run, get, all } = require('./db');
const { ocrBuffer } = require('./ocr');
const { extractFieldsFromText } = require('./extractors');
// We will reuse YOUR sendText below, and import only what we need from wa.js:
const { sendButtons, sendLocationList, downloadMediaById } = require('./wa');

const app = express();
app.use(express.json());

const VERIFY_TOKEN    = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN  = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

if (!VERIFY_TOKEN || !WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
  console.warn('[WARN] Missing one or more env vars:', {
    VERIFY_TOKEN: !!VERIFY_TOKEN, WHATSAPP_TOKEN: !!WHATSAPP_TOKEN, PHONE_NUMBER_ID: !!PHONE_NUMBER_ID
  });
}

function canSendRealWA() {
  if (process.env.FORCE_CONSOLE) return false; // keep console mode while test number is flaky
  return !!(PHONE_NUMBER_ID && WHATSAPP_TOKEN);
}

// YOUR existing simple text sender (kept as-is)
async function sendText(to, message) {
  if (!canSendRealWA()) {
    console.log(`[FAKE SEND -> ${to}] ${message}`);
    return { mocked: true };
    }
  const url = `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`;
  return axios.post(
    url,
    { messaging_product: 'whatsapp', to, text: { body: message } },
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } }
  );
}

app.get('/', (req, res) => res.status(200).send('OK'));

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

/* ---------- Parsing helpers ---------- */
function splitVerb(text) {
  const t = text.trim();
  const space = t.indexOf(' ');
  if (space === -1) return { verb: t.toLowerCase(), rest: '' };
  return { verb: t.slice(0, space).toLowerCase(), rest: t.slice(space + 1) };
}
function parseKVPairs(s) {
  const args = {};
  const re = /(\w+):"([^"]+)"|(\w+):(\S+)/g;
  let m;
  while ((m = re.exec(s))) {
    const key = (m[1] || m[3]).toLowerCase();
    const raw = (m[2] || m[4]).trim();
    args[key] = raw;
  }
  if (args.qty)   args.qty = parseInt(args.qty, 10) || 0;
  if (args.price) args.price = parseFloat(args.price);
  if (args.url)   args.photo_url = args.url;
  if (args.photo) args.photo_url = args.photo;
  if (args.loc)   args.location = args.loc;
  return args;
}
function parseNameAndInt(rest) {
  let r = rest.trim();
  if (!r) return null;
  let name = '', n = 1;
  if (r.startsWith('"')) {
    const end = r.indexOf('"', 1);
    if (end === -1) return null;
    name = r.slice(1, end);
    r = r.slice(end + 1).trim();
  } else {
    const parts = r.split(/\s+/);
    name = parts.shift();
    r = parts.join(' ').trim();
  }
  if (r) {
    const parsed = parseInt(r, 10);
    if (!Number.isNaN(parsed)) n = parsed;
  }
  return { name, n };
}

/* ---------- DB helpers ---------- */
async function addItem(userId, fields) {
  if (!fields.name) throw new Error('Missing name');
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  await run(
    `INSERT INTO items (user_id, name, category, size, qty, location, brand, price, photo_url, notes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, name) DO UPDATE SET
       category=excluded.category, size=excluded.size, qty=excluded.qty, location=excluded.location,
       brand=excluded.brand, price=excluded.price, photo_url=excluded.photo_url, notes=excluded.notes,
       updated_at=excluded.updated_at`,
    [
      userId, fields.name, fields.category || null, fields.size || null, fields.qty ?? 0,
      fields.location || null, fields.brand || null, fields.price ?? null, fields.photo_url || null,
      fields.notes || null, now
    ]
  );
}
async function getItem(userId, name) {
  return get(
    `SELECT name, category, size, qty, location, brand, price, photo_url, notes, updated_at
     FROM items WHERE user_id=? AND LOWER(name)=LOWER(?)`,
    [userId, name]
  );
}
function formatItem(i) {
  if (!i) return 'Not found.';
  const lines = [
    `🔖 ${i.name}`,
    i.category ? `• Category: ${i.category}` : null,
    i.size ? `• Size: ${i.size}` : null,
    `• Qty: ${i.qty ?? 0}`,
    i.location ? `• 📍 ${i.location}` : null,
    i.brand ? `• Brand: ${i.brand}` : null,
    i.price != null ? `• Price: $${i.price}` : null,
    i.photo_url ? `• 📸 ${i.photo_url}` : null,
    i.notes ? `• 📝 ${i.notes}` : null,
    i.updated_at ? `• Updated: ${i.updated_at}` : null
  ].filter(Boolean);
  return lines.join('\n');
}
async function listItems(userId, filters = {}) {
  const where = ['user_id = ?']; const params = [userId];
  if (filters.category) { where.push('LOWER(category)=?'); params.push(filters.category.toLowerCase()); }
  if (filters.location) { where.push('LOWER(location)=?'); params.push(filters.location.toLowerCase()); }
  const sql = `
    SELECT name, category, size, qty, location, brand, price, updated_at
    FROM items
    WHERE ${where.join(' AND ')}
    ORDER BY updated_at DESC
    LIMIT 50`;
  return all(sql, params);
}
function formatList(rows) {
  if (!rows || rows.length === 0) return 'No items found.';
  return rows.map(r => {
    const parts = [`qty:${r.qty ?? 0}`];
    if (r.size) parts.push(`size:${r.size}`);
    if (r.location) parts.push(`📍${r.location}`);
    if (r.brand) parts.push(r.brand);
    if (r.price != null) parts.push(`$${r.price}`);
    return `• ${r.name} — ${parts.join(' | ')}`;
  }).join('\n');
}
async function adjustQty(userId, name, delta) {
  const row = await get(`SELECT qty FROM items WHERE user_id=? AND LOWER(name)=LOWER(?)`, [userId, name]);
  if (!row) return null;
  const prev = Number.isInteger(row.qty) ? row.qty : 0;
  const next = Math.max(0, prev + delta);
  await run(`UPDATE items SET qty=?, updated_at=datetime('now') WHERE user_id=? AND LOWER(name)=LOWER(?)`,
    [next, userId, name]);
  return { name, prev, next };
}
async function moveItem(userId, name, newLoc) {
  if (!name || !newLoc) throw new Error('Missing name or location');
  const row = await get(`SELECT id FROM items WHERE user_id=? AND LOWER(name)=LOWER(?)`, [userId, name]);
  if (!row) return null;
  await run(`UPDATE items SET location=?, updated_at=datetime('now') WHERE user_id=? AND LOWER(name)=LOWER(?)`,
    [newLoc, userId, name]);
  return { name, location: newLoc };
}
async function setPhoto(userId, name, url) {
  if (!name || !url) throw new Error('Missing name or url');
  const row = await get(`SELECT id FROM items WHERE user_id=? AND LOWER(name)=LOWER(?)`, [userId, name]);
  if (!row) return null;
  await run(`UPDATE items SET photo_url=?, updated_at=datetime('now') WHERE user_id=? AND LOWER(name)=LOWER(?)`,
    [url, userId, name]);
  return { name, url };
}
async function deleteItem(userId, name) {
  const row = await get(`SELECT id FROM items WHERE user_id=? AND LOWER(name)=LOWER(?)`, [userId, name]);
  if (!row) return null;
  await run(`DELETE FROM items WHERE user_id=? AND LOWER(name)=LOWER(?)`, [userId, name]);
  return { name };
}
async function findItems(userId, rest) {
  const args = parseKVPairs(rest);
  const freeTokens = rest.split(/\s+/).filter(t => t && !t.includes(':')).map(t => t.toLowerCase());

  const where = ['user_id = ?']; const params = [userId];

  if (args.category) { where.push('LOWER(category)=?'); params.push(args.category.toLowerCase()); }
  if (args.location) { where.push('LOWER(location)=?'); params.push(args.location.toLowerCase()); }
  if (args.brand)    { where.push('LOWER(brand)=?');    params.push(args.brand.toLowerCase()); }
  if (args.size)     { where.push('LOWER(size)=?');     params.push(args.size.toLowerCase()); }
  if (args.name)     { where.push('LOWER(name)=?');     params.push(args.name.toLowerCase()); }

  for (const t of freeTokens) {
    where.push(`(LOWER(name) LIKE ? OR LOWER(size) LIKE ? OR LOWER(brand) LIKE ? OR LOWER(category) LIKE ? OR LOWER(location) LIKE ?)`);
    const p = `%${t}%`;
    params.push(p, p, p, p, p);
  }

  const sql = `
    SELECT name, category, size, qty, location, brand, price, updated_at
    FROM items
    WHERE ${where.join(' AND ')}
    ORDER BY updated_at DESC
    LIMIT 50`;
  return all(sql, params);
}

/* ---------- PHOTO MVP helpers ---------- */

// in-memory pending item per user (until they tap Save)
const pending = new Map();

async function getTopLocations(userId) {
  try {
    const rows = await all(`
      SELECT location, COUNT(*) AS c
      FROM items
      WHERE user_id = ? AND location IS NOT NULL AND location <> ''
      GROUP BY location
      ORDER BY c DESC
      LIMIT 6
    `, [userId]);
    const popular = rows.map(r => r.location);
    return popular.length ? popular : ['Garage/Bin2','Office/Drawer','Travel Bag','Kitchen/Shelf','Bedroom/Closet','Car/Glovebox'];
  } catch {
    return ['Garage/Bin2','Office/Drawer','Travel Bag','Kitchen/Shelf','Bedroom/Closet','Car/Glovebox'];
  }
}

async function savePendingItem(userId) {
  const p = pending.get(userId);
  if (!p) return null;
  const { fields, image_path, qty = 1, location } = p;
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  // Upsert by (user_id, name)
  await run(`
    INSERT INTO items (
      user_id, name, category, size, qty, location, brand, price, photo_url, notes,
      image_path, barcode, attributes, confidence, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, name) DO UPDATE SET
      category=excluded.category,
      size=excluded.size,
      qty=excluded.qty,
      location=excluded.location,
      brand=excluded.brand,
      image_path=excluded.image_path,
      barcode=excluded.barcode,
      attributes=excluded.attributes,
      confidence=excluded.confidence,
      updated_at=excluded.updated_at
  `, [
    userId,
    fields.name || '(unknown)',
    fields.category || null,
    fields.size || null,
    qty,
    location || null,
    fields.brand || null,
    null,          // price
    null,          // photo_url (external), not used here
    null,          // notes
    image_path || null,
    null,          // barcode (future)
    JSON.stringify(fields.attributes || {}),
    fields.confidence || 0,
    now
  ]);

  pending.delete(userId);
  return fields.name || '(unknown)';
}

/* ---------- Webhook ---------- */
app.post('/webhook', async (req, res) => {
  console.log('>>> Incoming Webhook:', JSON.stringify(req.body, null, 2));
  try {
    const entry = req.body.entry?.[0];
    const value = entry?.changes?.[0]?.value;
    const msg   = value?.messages?.[0];
    const from  = msg?.from;
    const name  = msg?.profile?.name;

    if (!from || !msg) { res.sendStatus(200); return; }

    // 1) Handle IMAGE messages (photo arrives)
    if (msg.type === 'image' && msg.image?.id) {
      if (!canSendRealWA()) {
        await sendText(from, '📸 I got your photo. To auto-read it and show buttons, turn off console mode and ensure WhatsApp API tokens are set.');
        res.sendStatus(200);
        return;
      }

      // 1) Download bytes via Graph
      const mediaId = msg.image.id;
      const buf = await downloadMediaById(mediaId);

      // 2) Save locally (URLs expire)
      const uploadsDir = path.join(__dirname, 'uploads');
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
      const filename = `${uuidv4()}.jpg`;
      const filePath = path.join(uploadsDir, filename);
      fs.writeFileSync(filePath, buf);

      // 3) OCR
      const { text } = await ocrBuffer(buf);

      // 4) Extract fields
      const fields = extractFieldsFromText(text);

      // 5) Seed pending state for this user
      pending.set(from, { fields, image_path: filePath, qty: 1, location: null });

      // 6) Ask to confirm with buttons
      const bodyText =
`Save this?
• Name: ${fields.name || '(unknown)'}
• Brand: ${fields.brand || '-'} • Size: ${fields.size || '-'}
• Cat: ${fields.category || '-'} • Conf: ${fields.confidence || 0}%
• Loc: (tap to set)`;

      await sendButtons(from, bodyText, [
        { id: 'save_item',    title: 'Save' },
        { id: 'set_location', title: 'Set Location' },
        { id: 'change_qty',   title: 'Change Qty' },
        { id: 'cancel',       title: 'Cancel' }
      ]);

      res.sendStatus(200);
      return;
    }

    // 2) Handle INTERACTIVE replies (buttons + list)
    if (msg.type === 'interactive') {
      const inter = msg.interactive;

      if (inter.type === 'button_reply') {
        const id = inter.button_reply.id;

        if (id === 'cancel') {
          pending.delete(from);
          await sendText(from, '❌ Cancelled.');
          res.sendStatus(200);
          return;
        }

        if (id === 'save_item') {
          const savedName = await savePendingItem(from);
          await sendText(from, `✅ Saved: ${savedName}`);
          res.sendStatus(200);
          return;
        }

        if (id === 'set_location') {
          const locs = await getTopLocations(from);
          if (canSendRealWA()) {
            await sendLocationList(from, locs);
          } else {
            await sendText(from, `Pick a location: ${locs.join(' | ')}`);
          }
          res.sendStatus(200);
          return;
        }

        if (id === 'change_qty') {
          if (canSendRealWA()) {
            await sendButtons(from, 'Choose quantity', [
              { id: 'qty_1', title: '1' },
              { id: 'qty_2', title: '2' },
              { id: 'qty_3', title: '3' },
              { id: 'qty_5', title: '5' },
            ]);
          } else {
            await sendText(from, 'Reply: qty_1 / qty_2 / qty_3 / qty_5');
          }
          res.sendStatus(200);
          return;
        }

        if (id.startsWith('qty_')) {
          const qty = parseInt(id.split('_')[1], 10) || 1;
          const p = pending.get(from) || {};
          pending.set(from, { ...p, qty });
          await sendText(from, `✔️ Quantity set to ${qty}. Tap "Save" when ready.`);
          res.sendStatus(200);
          return;
        }
      }

      if (inter.type === 'list_reply') {
        const title = inter.list_reply.title; // selected location title
        const p = pending.get(from) || {};
        pending.set(from, { ...p, location: title });
        await sendText(from, `📍 Location set: ${title}. Tap "Save" to store.`);
        res.sendStatus(200);
        return;
      }

      // Unknown interactive type
      await sendText(from, 'Got interactive reply.');
      res.sendStatus(200);
      return;
    }

    // 3) Fallback: TEXT commands (your existing logic)
    const text = msg?.text?.body;

    let reply = '';
    if (text) {
      const { verb, rest } = splitVerb(text);
      const cmd = verb;

      if (cmd === 'hi' || cmd === 'hello') {
        reply = name
          ? `Hello ${name}! 👋 Welcome to Home Assistant Bot.\nType "help" anytime.`
          : `Hello! 👋 Welcome to Home Assistant Bot.\nType "help" anytime.`;

      } else if (cmd === 'help') {
        reply = [
          `✅ *Commands:*`,
          `• add name:ac_filter qty:1 brand:Filtrete size:16x25x1 price:12.99`,
          `• get ac_filter`,
          `• list [category:<name>] [loc:<place>]`,
          `• inc "A19 bulb" 2   /   dec "A19 bulb" 1`,
          `• move name:"A19 bulb" loc:"Garage/Bin2"`,
          `• photo name:"ac_filter" url:https://link`,
          `• del name:"ac_filter"`,
          `• find screw 1.5in   OR   find category:electrical brand:Philips`,
          `Tip: Use quotes for spaces → name:"A19 bulb"`,
          ``,
          `📸 Also: send a product *photo* to add it with buttons (beta).`
        ].join('\n');

      } else if (cmd === 'add') {
        try {
          const args = parseKVPairs(rest);
          await addItem(from, args);
          reply = `✅ Item "${args.name}" saved!`;
        } catch (e) {
          reply = `⚠️ Could not save. ${e.message}\nExample:\nadd name:ac_filter qty:1 price:12.99`;
        }

      } else if (cmd === 'get') {
        const nm = rest.trim().replace(/^"|"$/g, '');
        reply = nm
          ? (await getItem(from, nm) ? formatItem(await getItem(from, nm)) : `Not found. Try: add name:${nm} qty:1`)
          : `Usage: get <name>\nExample: get ac_filter`;

      } else if (cmd === 'list') {
        const a = parseKVPairs(rest);
        reply = formatList(await listItems(from, { category: a.category, location: a.location }));

      } else if (cmd === 'inc' || cmd === 'dec') {
        const p = parseNameAndInt(rest);
        if (!p || !p.name) reply = `Usage:\ninc "name" 2\nor\ndec name 1`;
        else {
          const delta = (cmd === 'inc' ? +p.n : -p.n) || (cmd === 'inc' ? 1 : -1);
          const result = await adjustQty(from, p.name, delta);
          reply = result ? `✅ ${p.name}: qty ${result.next} (was ${result.prev})`
                         : `Not found. Try: add name:${p.name} qty:1`;
        }

      } else if (cmd === 'move') {
        const a = parseKVPairs(rest);
        const nm = a.name || (rest.match(/^"([^"]+)"/)?.[1]) || rest.split(/\s+/)[0];
        const loc = a.location;
        reply = (!nm || !loc) ? `Usage: move name:"<item>" loc:"<new location>"`
              : (await moveItem(from, nm, loc)) ? `✅ Moved "${nm}" to 📍 ${loc}` : `Not found: ${nm}`;

      } else if (cmd === 'photo') {
        const a = parseKVPairs(rest);
        reply = (!a.name || !a.photo_url) ? `Usage: photo name:"<item>" url:<link>`
              : (await setPhoto(from, a.name, a.photo_url)) ? `✅ Photo saved for "${a.name}"` : `Not found: ${a.name}`;

      } else if (cmd === 'del') {
        const a = parseKVPairs(rest);
        const nm = a.name || rest.trim().replace(/^"|"$/g, '');
        reply = !nm ? `Usage: del name:"<item>"`
              : (await deleteItem(from, nm)) ? `🗑️ Deleted "${nm}"` : `Not found: ${nm}`;

      } else if (cmd === 'find') {
        reply = formatList(await findItems(from, rest));

      } else {
        reply = `You said: "${text}"\nType "help" for commands.`;
      }
    } else {
      reply = `I received your message 👍 (non-text). Try sending a text like "hi" or "help".`;
    }

    await sendText(from, reply);
    res.sendStatus(200);

  } catch (e) {
    if (e?.response?.data) console.error('webhook error (API):', JSON.stringify(e.response.data, null, 2));
    else console.error('webhook error:', e.message);
    res.sendStatus(200);
  }
});

(async () => {
  try {
    await init();
    console.log('SQLite ready ✅');
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Bot running on http://localhost:${PORT}`));
  } catch (err) {
    console.error('DB init failed:', err);
    process.exit(1);
  }
})();
