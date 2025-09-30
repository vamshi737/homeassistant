// ocr.js
const { createWorker } = require('tesseract.js');

let workerPromise;
function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker();
      await worker.loadLanguage('eng');
      await worker.initialize('eng');
      return worker;
    })();
  }
  return workerPromise;
}

async function ocrBuffer(buf) {
  const worker = await getWorker();
  const { data } = await worker.recognize(buf);
  return { text: data.text || '', confidence: data.confidence ?? 0 };
}

module.exports = { ocrBuffer };
