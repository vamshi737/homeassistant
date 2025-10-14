// extractors.js

function titleCase(s) {
  return (s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}
function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
function norm(s)  { return (s || '').toLowerCase(); }

// Common brands (electronics + store brands + personal care)
const BRAND_LIST = [
  // electronics / store
  'Apple','Onn','Anker','Belkin','Philips','Logitech','Samsung','Sony','Mi','Xiaomi',
  'JBL','Boat','Meridian','Google','Razer','HP','Dell','Lenovo','Acer','Asus','Amazon',
  'TP-Link','Netgear','Realme','OnePlus','Ugreen','Baseus','Aukey',
  'Duracell','Energizer','Kirkland','Great Value',"Member's Mark","Members Mark","Member S Mark",

  // personal care (CPG)
  'Irish Spring','Dove','Nivea','Old Spice','Axe','Palmolive','Colgate','Sensodyne',
  'Head & Shoulders','Head and Shoulders','Pantene','Herbal Essences','Lifebuoy','Safeguard',
  'Dial','Softsoap','Aveeno','Cetaphil','Neutrogena','Olay','Gillette'
];

function findBrand(txt) {
  const t = norm(txt);

  // normalize common variants / misspellings
  if (/\bmember'?s?\s+mark\b/.test(t)) return "Member's Mark";
  if (/\bkirkland\b/.test(t)) return 'Kirkland';
  if (/\bgreat\s+value\b/.test(t)) return 'Great Value';
  if (/\bonn\b/.test(t)) return 'Onn';
  if (/\bxiomi\b/.test(t)) return 'Xiaomi';
  if (/\bhead\s*&\s*shoulders\b/.test(t) || /\bhead\s+and\s+shoulders\b/.test(t)) return 'Head & Shoulders';

  for (const raw of BRAND_LIST) {
    const b = raw.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const re = new RegExp(`\\b${b}\\b`, 'i');
    if (re.test(txt)) return raw.replace(/Members Mark|Member S Mark/i, "Member's Mark");
  }

  // Heuristic fallback: first ALL-CAPS-ish line (often a logo)
  const line = (txt.split('\n')
    .map(l => l.trim())
    .find(l => /^[A-Z][A-Z0-9 '&.-]{3,}(?:\s+[A-Z0-9 '&.-]{2,})*$/.test(l)) || '').trim();
  return line ? titleCase(line.split(/\s{2,}|\s-\s/)[0]) : null;
}

function findCountOrSize(txt) {
  const t = norm(txt);

  // general counts
  const mCt = t.match(/\b(\d{1,4})\s*(ct|count|pcs?|pack)\b/);
  if (mCt) return `${mCt[1]}ct`;

  // electronics capacity / power
  const mW = t.match(/\b(\d{1,3})\s*w\b/);
  if (mW) return `${mW[1]} W`;
  const mMah = t.match(/\b(\d{3,5})\s*mAh\b/);
  if (mMah) return `${mMah[1]} mAh`;

  // liquids / weight for personal care / pantry
  const mFloz = t.match(/\b(\d{1,3}(?:\.\d)?)\s*(fl\.?\s*oz|fluid\s*ounces?)\b/);
  if (mFloz) return `${mFloz[1]} fl oz`;
  const mMl = t.match(/\b(\d{2,4})\s*ml\b/);
  if (mMl) return `${mMl[1]} ml`;
  const mL = t.match(/\b(\d(?:\.\d)?)\s*l\b/);
  if (mL) return `${mL[1]} L`;
  const mG = t.match(/\b(\d{2,4})\s*g\b/);
  if (mG) return `${mG[1]} g`;

  // resolution (monitors etc.)
  const mRes = t.match(/\b(4k|1440p|1080p|720p)\b/i);
  if (mRes) return mRes[1].toUpperCase();

  // bulbs
  const mA = t.match(/\bA(19|21|60|67)\b/);
  if (mA) return `A${mA[1]}`;
  const mBase = t.match(/\bE(26|27)\b/);
  if (mBase) return `E${mBase[1]}`;

  return null;
}

function findCategory(txt) {
  const t = norm(txt);
  if (/(paper\s*plates?|napkins?|tissues?|paper\s*towels?)/.test(t)) return 'household';
  if (/(bulb|led\s*bulb|lamp)/.test(t)) return 'electrical';
  if (/(web\s?cam|webcam|camera)/.test(t)) return 'electronics';
  if (/(charger|adapter|usb[- ]?c)/.test(t)) return 'electronics';
  if (/(power\s*bank|battery\s*pack)/.test(t)) return 'electronics';
  // personal care
  if (/(body\s*washes?|bodywash|shampoo|conditioner|hand\s*soap|bar\s*soap|face\s*washes?)/.test(t)) return 'personal care';
  return null;
}

function findProductNoun(txt) {
  const t = norm(txt);
  if (/(paper\s*plates?|plates)/.test(t)) return 'Paper Plates';
  if (/(airpods)/.test(t)) return 'AirPods';
  if (/(web\s?cam|webcam)/.test(t)) return 'Webcam';
  if (/(power\s*bank)/.test(t)) return 'Power Bank';
  if (/(usb[- ]?c\s*charger|charger|adapter)/.test(t)) return 'Charger';
  if (/(led\s*bulb|bulb)/.test(t)) return 'LED Bulb';
  // personal care
  if (/(body\s*washes?|bodywash)/.test(t)) return 'Body Wash';
  if (/\bshampoo\b/.test(t)) return 'Shampoo';
  if (/\bconditioner\b/.test(t)) return 'Conditioner';
  if (/\bhand\s*soap\b/.test(t)) return 'Hand Soap';
  if (/\bbar\s*soap\b/.test(t)) return 'Bar Soap';
  if (/\bface\s*washes?\b/.test(t)) return 'Face Wash';
  return null;
}

function refineBulbBits(txt) {
  const t = norm(txt);
  const a = (t.match(/\bA(19|21|60|67)\b/i) || [])[0];
  const e = (t.match(/\bE(26|27)\b/i) || [])[0];
  const dim = /\bdimmable\b/i.test(t) ? 'Dimmable' : null;
  return [a, e, dim].filter(Boolean).join(' ');
}

function buildName({ brand, noun, size, txt }) {
  let name;
  if (noun) {
    name = `${brand ? brand + ' ' : ''}${noun}`;
    if (noun === 'LED Bulb') {
      const bits = refineBulbBits(txt);
      if (bits) name += ` ${bits}`;
    }
  } else {
    // fallback: first decent CAPS token (avoid tech abbreviations)
    const caps = (txt.match(/\b[A-Z][A-Z0-9'-]{2,}\b/g) || [])
      .filter(w => !/USB|LED|CE|FCC|TM|CM|UL|ETL/i.test(w));
    name = brand ? `${brand}${caps[0] ? ' ' + caps[0] : ''}` : (caps[0] || 'Item');
  }
  if (size) name += ` ${size}`;
  return titleCase(clean(name));
}

function scoreConfidence({ brand, noun, size }) {
  let c = 50;
  if (brand) c += 20;
  if (noun)  c += 20;
  if (size)  c += 8;
  if (c > 98) c = 98;
  if (c < 20) c = 20;
  return c;
}

function extractFieldsFromText(text) {
  const txt = clean(text || '');

  const brand    = findBrand(txt);
  const noun     = findProductNoun(txt);
  const size     = findCountOrSize(txt);
  const category = findCategory(txt);

  const name        = buildName({ brand, noun, size, txt });
  const confidence  = scoreConfidence({ brand, noun, size });

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
