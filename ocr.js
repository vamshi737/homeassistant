// ocr.js
const Tesseract = require('tesseract.js');

async function ocrBuffer(buf) {
  try {
    // Simple, version-safe call
    const { data } = await Tesseract.recognize(buf, 'eng');
    return {
      text: (data && data.text ? data.text : '').trim(),
      confidence: Number.isFinite(data?.confidence) ? data.confidence : 0
    };
  } catch (e) {
    console.error('OCR error:', e.message);
    return { text: '', confidence: 0 };
  }
}

module.exports = { ocrBuffer };
