// ocr.js
const Tesseract = require('tesseract.js');

// sharp is optional; if it's not installed, we fall back gracefully.
let sharp;
try { sharp = require('sharp'); } catch { sharp = null; }

async function preprocess(buf) {
  // Make text easier for Tesseract: autorotate, grayscale, normalize, sharpen, upscale
  if (!sharp) return buf;
  try {
    return await sharp(buf)
      .rotate()
      .grayscale()
      .normalise()
      .sharpen()
      .resize({ width: 2200, withoutEnlargement: false })
      .toBuffer();
  } catch {
    return buf;
  }
}

async function ocrBuffer(buf) {
  try {
    const input = await preprocess(buf);
    const { data } = await Tesseract.recognize(input, 'eng', {
      // logger: m => console.log('tesseract:', m) // uncomment for debugging
    });
    const text = (data?.text || '').replace(/\r/g, '').trim();
    const confidence = Number.isFinite(data?.confidence) ? Math.round(data.confidence) : 0;
    return { text, confidence };
  } catch (e) {
    console.error('OCR error:', e.message);
    return { text: '', confidence: 0 };
  }
}

module.exports = { ocrBuffer };
