// extractors.js

function titleCase(s) {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/\b\w/g, c => c.toUpperCase());
}
function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
function norm(s) { return (s || '').toLowerCase(); }

// Common brands (incl. store brands)
const BRAND_LIST = [
  'Apple','Onn','Anker','Belkin','Philips','Logitech','Samsung','Sony','Mi','Xiaomi',
  'JBL','Boat','Meridian','Google','Razer','HP','Dell','Lenovo','Acer','Asus','Amazon',
  'TP-Link','Netgear','Realme','OnePlus','Duracell','Energizer','Kirkland','Great Value',
  "Member's Mark","Members Mark","Member S Mark","Equate","Ugreen","Baseus","Aukey",
  'Luxreve','LUXREVE'
];

function findBrand(txt) {
  const t = norm(txt);
  // variants first
  if (/\bmember'?s?\s+mark\b/.test(t)) return "Member's Mark";
  if (/\bkirkland\b/.test(t)) return 'Kirkland';
  if (/\bgreat\s+value\b/.test(t)) return 'Great Value';
  if (/\bonn\b/.test(t)) return 'Onn';
  if (/\bxiomi\b/.test(t)) return 'Xiaomi'; // misspelling

  for (const raw of BRAND_LIST) {
    const b = norm(raw);
    const re = new RegExp(`\\b${b.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
    if (re.test(txt)) return raw.replace(/Members Mark|Member S Mark/i, "Member's Mark");
  }

  // Heuristic: first ALLCAPS-ish logo line
  const line = (txt.split('\n')
    .map(l => l.trim())
    .find(l => /^[A-Z][A-Z0-9 '&.-]{3,}$/.test(l)) || '').trim();
  return line ? titleCase(line.split(/\s{2,}|\s-\s/)[0]) : null;
}

function findCountOrSize(txt) {
  const t = norm(txt);

  // Counts: 204 ct / 200 count / 20 pcs / 4 pack / 3-pack
  const mCt = t.match(/\b(\d{1,4})\s*(ct|count|pcs?|pack)\b|(\d{1,4})-pack\b/);
  if (mCt) {
    const n = mCt[1] || mCt[3];
    return `${n}ct`;
  }

  // Power/capacity/resolution only in sensible contexts
  const likelyPowerCtx = /(bulb|led|lamp|watt|charger|adapter|power|usb)/.test(t);

  const mW = likelyPowerCtx ? t.match(/\b(\d{1,3})\s*w(?:att)?s?\b/) : null;
  if (mW) return `${mW[1]}W`;

  const mMah = t.match(/\b(\d{3,5})\s*mAh\b/i);
  if (mMah) return `${mMah[1]}mAh`;

  const mRes = t.match(/\b(4k|1440p|1080p|720p)\b/i);
  if (mRes) return mRes[1].toUpperCase();

  // Bulb forms/bases
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
  if (/(charger|adapter|usb[- ]?c|power\s*(brick|adapter))/ .test(t)) return 'electronics';
  if (/(power\s*bank|battery\s*pack)/.test(t)) return 'electronics';
  if (/\bairpods?\b/.test(t)) return 'electronics';
  if (/(watch\s*(case|roll)|watch\s*travel\s*pouch)/.test(t)) return 'storage';
  return null;
}

function findProductNoun(txt) {
  const t = norm(txt);
  if (/(paper\s*plates?|plates)/.test(t)) return 'Paper Plates';
  if (/\bairpods?\b/.test(t)) return 'AirPods';
  if (/(web\s?cam|webcam)/.test(t)) return 'Webcam';
  if (/(power\s*bank)/.test(t)) return 'Power Bank';
  if (/(usb[- ]?c\s*charger|charger|adapter)/.test(t)) return 'Charger';
  if (/(led\s*bulb|bulb)/.test(t)) return 'LED Bulb';
  if (/(watch\s*(case|roll)|watch\s*travel\s*pouch)/.test(t)) return 'Watch Case';
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
    // Fallback: first decent caps token (avoid common labels)
    const caps = (txt.match(/\b[A-Z][A-Z0-9'-]{2,}\b/g) || [])
      .filter(w => !/USB|LED|CE|FCC|TM|CM|UL|ETL|CT|OZ|ML/i.test(w));
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

  const brand = findBrand(txt);
  const noun  = findProductNoun(txt);
  const size  = findCountOrSize(txt);
  const category = findCategory(txt);

  const name = buildName({ brand, noun, size, txt });
  const confidence = scoreConfidence({ brand, noun, size });

  return {
    name,
    brand: brand || null,
    category: category || null,
    size: size || null,
    confidence,
    attributes: { noun } // helpful for comparisons
  };
}

module.exports = { extractFieldsFromText };
