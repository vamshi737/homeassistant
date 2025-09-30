// extractors.js
const BRANDS = [
  'Apple','Anker','Philips','Rust-Oleum','KILZ','Samsung','Sony','LG','Bosch','Makita','DEWALT',
  'Acer','Asus','Lenovo','Dell','HP','Dyson','NETGEAR','TP-Link'
];

const COLORS = [
  'black','white','blue','red','green','yellow','orange','purple','pink','gray','grey',
  'silver','gold','beige','brown','navy','teal','maroon'
];

// simple keyword → category map
const CATEGORY_MAP = [
  { kw: ['primer','kilz','rust-oleum','paint','spray'], category: 'paint' },
  { kw: ['power bank','mah','charger','usb-c','usb a','lightning',' w'], category: 'electronics' },
  { kw: ['bulb','led','lamp'], category: 'electrical' },
  { kw: ['screw','nail','drill','hammer'], category: 'tools' },
  { kw: ['router','modem'], category: 'network' },
];

function findBrand(text) {
  const t = text.toLowerCase();
  const hit = BRANDS.find(b => t.includes(b.toLowerCase()));
  return hit || null;
}

function findColor(text) {
  const t = text.toLowerCase();
  const hit = COLORS.find(c => t.includes(c));
  return hit || null;
}

function findSize(text) {
  // matches things like 20000mAh, 20W, 500ml, 1.5L, 12in, 3ft, 1gal, etc.
  const re = /\b(\d{2,5}\s?(mAh|W|Wh|V|A)|\d+(\.\d+)?\s?(ml|l|oz|g|kg|mm|cm|in|ft|yd|qt|gal))\b/ig;
  let m, best = null;
  while ((m = re.exec(text)) !== null) {
    const val = m[0].replace(/\s+/g,'').toLowerCase();
    if (!best || val.length > best.length) best = val;
  }
  return best;
}

function findCategory(text) {
  const t = text.toLowerCase();
  for (const row of CATEGORY_MAP) {
    if (row.kw.some(k => t.includes(k))) return row.category;
  }
  return null;
}

function guessName(text, brand, size) {
  // take a meaningful line
  const lines = text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  let line = lines.find(l => brand && l.toLowerCase().includes(brand.toLowerCase())) || lines[0] || '';
  line = line.replace(/\s{2,}/g,' ').trim();

  const parts = [];
  if (brand) parts.push(brand);
  const core = brand ? line.replace(new RegExp(brand, 'i'), '').trim() : line;
  if (core) parts.push(core);
  if (size && !parts.join(' ').toLowerCase().includes(size.toLowerCase())) parts.push(size);
  return parts.join(' ').replace(/\s+/g,' ').trim();
}

function extractFieldsFromText(text) {
  const brand = findBrand(text);
  const size = findSize(text);
  const color = findColor(text);
  const category = findCategory(text);
  const name = guessName(text, brand, size);
  const found = [brand, size, color, category].filter(Boolean).length;
  const confidence = Math.round((found / 4) * 100);
  return { name, brand, size, color, category, confidence, attributes: { raw: text.slice(0, 2000) } };
}

module.exports = { extractFieldsFromText };
