// extractors.js
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s; }
function title(s) { return s.replace(/\s+/g,' ').trim().split(' ').map(cap).join(' '); }

const BRAND_LIST = [
  'Apple','Onn','Mi','Xiaomi','Philips','Belkin','Anker','Logitech','Samsung','Sony',
  'Meridian','Boat','JBL','Google','Razer','HP','Dell','Lenovo','Acer','Asus','Amazon',
  'TP-Link','Netgear','Realme','OnePlus'
];

function findBrand(txt) {
  for (const b of BRAND_LIST) {
    const re = new RegExp(`\\b${b.replace('-', '\\-')}\\b`, 'i');
    if (re.test(txt)) return b;
  }
  if (/\bonn\b/i.test(txt)) return 'Onn';
  if (/\bxiomi\b/i.test(txt)) return 'Xiaomi';
  return null;
}

function findType(txt) {
  if (/\bairpods?\b/i.test(txt)) return { type: 'AirPods', category: 'electronics' };
  if (/\b(web ?cam|webcam)\b/i.test(txt)) return { type: 'Webcam', category: 'electronics' };
  if (/\b(charger|adapter)\b/i.test(txt)) return { type: 'Charger', category: 'electronics' };
  if (/\b(led\s*bulb|bulb)\b/i.test(txt)) return { type: 'LED Bulb', category: 'electrical' };
  if (/\b(power\s*bank)\b/i.test(txt)) return { type: 'Power Bank', category: 'electronics' };
  return { type: null, category: null };
}

function findSize(txt) {
  const res = (txt.match(/\b(4k|1440p|1080p|720p)\b/i) || [])[1];
  if (res) return res.toUpperCase();
  const watts = (txt.match(/\b(\d{1,3})\s?W\b/i) || [])[1];
  if (watts) return `${watts}W`;
  const mah = (txt.match(/\b(\d{3,5})\s?mAh\b/i) || [])[1];
  if (mah) return `${mah}mAh`;
  const abulb = (txt.match(/\bA([0-9]{2})\b/i) || [])[0];
  if (abulb) return abulb.toUpperCase();
  return null;
}

function refineTypeForBulbs(txt, type) {
  if (type !== 'LED Bulb') return null;
  const aForm = (txt.match(/\bA(19|21|60|67)\b/i) || [])[0];
  const base = (txt.match(/\bE(26|27)\b/i) || [])[0];
  const dimm = /\bdimmable\b/i.test(txt) ? 'Dimmable' : null;
  const parts = [aForm, base, dimm].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

function buildName({ brand, type, size, txt }) {
  let name = null;

  if (/airpods/i.test(txt)) {
    name = `${brand || 'Apple'} AirPods`;
    if (size) name += ` ${size}`;
    return title(name);
  }

  if (type) {
    name = `${brand ? brand + ' ' : ''}${type}`;
    const bulbBits = refineTypeForBulbs(txt, type);
    if (bulbBits) name += ` ${bulbBits}`;
    if (size) name += ` ${size}`;
    return title(name);
  }

  const caps = (txt.match(/\b[A-Z]{3,}\b/g) || []).filter(w => !/USB|LED|CE|FCC|TM|CM/i.test(w));
  if (brand && caps.length) name = `${brand} ${caps[0]}`;
  else name = brand || (caps[0] ? caps[0] : 'Item');

  if (size) name += ` ${size}`;
  return title(name);
}

function scoreConfidence({ brand, type, size }) {
  let c = 40;
  if (brand) c += 20;
  if (type) c += 25;
  if (size) c += 10;
  if (c > 98) c = 98;
  if (c < 10) c = 10;
  return c;
}

function extractFieldsFromText(text) {
  const txt = (text || '').replace(/\s+/g, ' ').trim();
  const brand = findBrand(txt);
  const { type, category } = findType(txt);
  const size = findSize(txt);

  const name = buildName({ brand, type, size, txt });
  const confidence = scoreConfidence({ brand, type, size });

  return {
    name,
    brand: brand || null,
    category: category || null,
    size: size || null,
    confidence,
    attributes: {}
  };
}

module.exports = { extractFieldsFromText };
