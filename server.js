// server.js
const express = require('express');
const axios = require('axios');
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');

const { init, run, get, all } = require('./db');
const { ocrBuffer } = require('./ocr');
const { extractFieldsFromText } = require('./extractors');
const { sendButtons, sendLocationList, downloadMediaById } = require('./wa');

const app = express();
app.use(express.json());

// serve saved images publicly (for photo_url)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const VERIFY_TOKEN    = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN  = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

if (!VERIFY_TOKEN || !WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
  console.warn('[WARN] Missing one or more env vars:', {
    VERIFY_TOKEN: !!VERIFY_TOKEN, WHATSAPP_TOKEN: !!WHATSAPP_TOKEN, PHONE_NUMBER_ID: !!PHONE_NUMBER_ID
  });
}

function canSendRealWA() {
  if (process.env.FORCE_CONSOLE) return false;
  return !!(PHONE_NUMBER_ID && WHATSAPP_TOKEN);
}

// simple text sender (used in addition to wa.js helpers)
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

/* ---------- helpers ---------- */
function splitVerb(text) {
  const t = (text || '').trim();
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
  let r = (rest || '').trim();
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
function sanitize(s, limit = 120) {
  return (s || '').replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim().slice(0, limit);
}
function previewBody(fields) {
  return `Save this?
• Name: ${sanitize(fields.name, 80) || '(unknown)'}
• Brand: ${sanitize(fields.brand, 40) || '-'} • Size: ${sanitize(fields.size, 24) || '-'}
• Cat: ${sanitize(fields.category, 24) || '-'} • Conf: ${fields.confidence || 0}%
• Loc: (tap to set)`;
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
  if (filters.category) { where.push('LOWER(category)=?'); params.push((filters.category || '').toLowerCase()); }
  if (filters.location) { where.push('LOWER(location)=?'); params.push((filters.location || '').toLowerCase()); }
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

/* ---------- PHOTO MVP state ---------- */
const pending = new Map();

const DEFAULT_LOCS = (process.env.DEFAULT_LOCATIONS
  ? process.env.DEFAULT_LOCATIONS.split(',').map(s => s.trim()).filter(Boolean)
  : [
      'Office/Drawer','Garage/Bin2','Workshop Drawer','Kitchen/Pantry',
      'Bedroom/Closet','Living Room/TV Stand','Car/Glovebox','Travel Bag',
      'Toolbox','Shed'
    ]);

async function getTopLocations(userId) {
  try {
    const rows = await all(`
      SELECT location, COUNT(*) AS c
      FROM items
      WHERE user_id = ? AND location IS NOT NULL AND location <> ''
      GROUP BY location
      ORDER BY c DESC
      LIMIT 10
    `, [userId]);
    const popular = rows.map(r => r.location).filter(Boolean);
    return [...new Set([...popular, ...DEFAULT_LOCS])].slice(0, 9);
  } catch {
    return DEFAULT_LOCS.slice(0, 9);
  }
}

function cleanupPendingFiles(p) {
  if (!p) return;
  const paths = p.image_paths || (p.image_path ? [p.image_path] : []);
  for (const f of paths) {
    try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  }
}

async function savePendingItem(userId) {
  const p = pending.get(userId);
  if (!p) return null;
  const { fields, image_path, qty = 1, location } = p;
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  const base = process.env.PUBLIC_BASE_URL ? process.env.PUBLIC_BASE_URL.replace(/\/$/, '') : null;
  const photoUrl = base && image_path ? `${base}/uploads/${path.basename(image_path)}` : null;

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
      photo_url=excluded.photo_url,
      updated_at=excluded.updated_at
  `, [
    userId,
    fields.name || '(unknown)',
    fields.category || null,
    fields.size || null,
    qty,
    location || null,
    fields.brand || null,
    null,
    photoUrl,
    null,
    image_path || null,
    null,
    JSON.stringify(fields.attributes || {}),
    fields.confidence || 0,
    now
  ]);

  pending.delete(userId); // keep file; we serve it via /uploads
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

    // 1) IMAGE messages
    if (msg.type === 'image' && msg.image?.id) {
      if (!canSendRealWA()) {
        await sendText(from, '📸 Photo received. Set your WhatsApp API tokens to enable auto-read + buttons.');
        res.sendStatus(200);
        return;
      }

      const mediaId = msg.image.id;
      const buf = await downloadMediaById(mediaId);

      // Save locally
      const uploadsDir = path.join(__dirname, 'uploads');
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
      const filename = `${randomUUID()}.jpg`;
      const filePath = path.join(uploadsDir, filename);
      fs.writeFileSync(filePath, buf);

      // OCR this photo
      const { text } = await ocrBuffer(buf);
      console.log('[OCR length]', (text || '').length, (text || '').slice(0, 300));

      // Merge with any previous photo text
      const prev = pending.get(from);
      const mergedText = prev?.text ? `${prev.text}\n${text}` : text;

      // Re-extract with all text we have
      const fields = extractFieldsFromText(mergedText);

      // keep state
      const image_paths = prev?.image_paths ? [...prev.image_paths, filePath] : [filePath];
      pending.set(from, {
        ...(prev || {}),
        fields,
        text: mergedText,
        image_paths,
        image_path: image_paths[0],     // first photo is primary
        qty: prev?.qty ?? 1,
        location: prev?.location ?? null,
        createdAt: prev?.createdAt ?? Date.now(),
        waiting: null
      });

      const bodyText = previewBody(fields);

      // Always show buttons so user can Save/Edit/Set Location immediately
      await sendButtons(from, bodyText, [
        { id: 'save_item',    title: 'Save' },
        { id: 'edit_item',    title: 'Edit' },
        { id: 'set_location', title: 'Set Location' }
      ]);

      res.sendStatus(200);
      return;
    }

    // 2) INTERACTIVE replies (buttons + list)
    if (msg.type === 'interactive') {
      const inter = msg.interactive;

      if (inter.type === 'button_reply') {
        const id = inter.button_reply.id;

        if (id === 'save_item') {
          const savedName = await savePendingItem(from);
          await sendText(from, `✅ Saved: ${savedName}`);
          res.sendStatus(200);
          return;
        }

        if (id === 'edit_item') {
          const p = pending.get(from);
          if (!p) {
            await sendText(from, 'No pending item. Send a photo first.');
          } else {
            pending.set(from, { ...p, waiting: 'edit' });
            await sendText(from,
`✍️ Edit fields, then tap *Save*:
• edit_name <new name>
• edit_brand <brand>
• edit_size <size or count>
• edit_cat <category>
• edit_qty <number>

Current:
- name: ${p.fields?.name || '(unknown)'}
- brand: ${p.fields?.brand || '-'}
- size: ${p.fields?.size || '-'}
- cat: ${p.fields?.category || '-'}
- qty: ${p.qty ?? 1}`);
          }
          res.sendStatus(200);
          return;
        }

        if (id === 'set_location') {
          const locs = await getTopLocations(from); // up to 9; wa.js adds "Other…"
          if (canSendRealWA()) {
            await sendLocationList(from, locs);
          } else {
            await sendText(from, `Pick a location: ${locs.join(' | ')}`);
          }
          res.sendStatus(200);
          return;
        }
      }

      if (inter.type === 'list_reply') {
        const id = inter.list_reply.id;
        const title = inter.list_reply.title;

        // Special row: free-typed location
        if (id === 'loc_OTHER') {
          const p = pending.get(from) || {};
          pending.set(from, { ...p, waiting: 'custom_location' });
          await sendText(from, '✍️ Type the location name (e.g., Kitchen/Pantry).');
          res.sendStatus(200);
          return;
        }

        const p = pending.get(from) || {};
        pending.set(from, { ...p, location: title });
        await sendText(from, `📍 Location set: ${title}. Tap "Save" to store.`);
        res.sendStatus(200);
        return;
      }

      await sendText(from, 'Got interactive reply.');
      res.sendStatus(200);
      return;
    }

    // 3) TEXT commands (and typed custom location capture + edit_* commands)
    const text = msg?.text?.body;
    let reply = '';
    if (text) {
      // If we are waiting for a custom location, treat this text as the location
      const maybePending = pending.get(from);

      if (maybePending?.waiting === 'custom_location') {
        const loc = text.trim().slice(0, 60);
        pending.set(from, { ...maybePending, waiting: null, location: loc });
        await sendText(from, `📍 Location set: ${loc}. Tap "Save" to store.`);
        res.sendStatus(200);
        return;
      }

      // --- edit_* commands for current pending item ---
      const { verb, rest } = splitVerb(text);
      if (verb.startsWith('edit_')) {
        const p = pending.get(from);
        if (!p) {
          await sendText(from, 'No pending item to edit. Send a photo first.');
          res.sendStatus(200); return;
        }

        const f = { ...(p.fields || {}) };
        const value = (rest || '').trim().slice(0, 80);

        if (!value && verb !== 'edit_qty') {
          await sendText(from, `Usage: ${verb} <value>`);
          res.sendStatus(200); return;
        }

        if (verb === 'edit_name')  f.name = value;
        if (verb === 'edit_brand') f.brand = value;
        if (verb === 'edit_size')  f.size = value;
        if (verb === 'edit_cat')   f.category = value;
        if (verb === 'edit_qty')   p.qty = Math.max(0, parseInt(value, 10) || 0);

        f.confidence = f.confidence || 70;
        pending.set(from, { ...p, fields: f });

        await sendButtons(from, previewBody(f), [
          { id: 'save_item',    title: 'Save' },
          { id: 'edit_item',    title: 'Edit' },
          { id: 'set_location', title: 'Set Location' }
        ]);
        res.sendStatus(200);
        return;
      }

      // --- normal commands ---
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
          ``,
          `📸 Photo flow: tap *Edit* to tweak fields, then *Save*.`,
          `   Text edits: edit_name ..., edit_brand ..., edit_size ..., edit_cat ..., edit_qty ...`
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

      } else if (cmd === 'loc') {
        const place = rest.trim();
        if (!place) {
          reply = 'Usage: loc <place>\nExample: loc Kitchen/Pantry';
        } else {
          const p = pending.get(from);
          if (!p) reply = 'No pending photo. Send a product photo first.';
          else {
            pending.set(from, { ...p, location: place, waiting: null });
            reply = `📍 Location set: ${place}. Tap "Save" to store.`;
          }
        }

      } else if (cmd === 'cancel') {
        const p = pending.get(from);
        cleanupPendingFiles(p);
        pending.delete(from);
        reply = '❌ Cancelled.';

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
