// controllers/localOCR.js
const { createWorker } = require("tesseract.js");

// Timeout helper
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("OCR TIMEOUT")), ms)
    ),
  ]);
}

// 🔥 CREA UN SOLO WORKER (più veloce e stabile)
let workerInstance = null;

async function getWorker() {
  if (!workerInstance) {
    console.log("🟦 OCR: creating worker (eng only)...");
    workerInstance = await createWorker("eng"); // niente ITA → non installata
  }
  return workerInstance;
}

// 🔥 OCR per singola immagine con protezioni
async function extractTextFromImage(filePath) {
  try {
    const worker = await getWorker();

    const { data } = await withTimeout(
      worker.recognize(filePath),
      5000 // timeout 5s per immagine
    );

    return data.text || "";
  } catch (err) {
    console.error("⚠️ OCR ERROR for image:", filePath, err.message);
    return ""; // fallback, mai bloccare
  }
}

// 🔥 OCR multiplo sicuro
exports.extractTextFromImages = async (files) => {
  let finalText = "";

  for (const f of files) {
    const text = await extractTextFromImage(f.path);
    finalText += "\n" + text;
  }

  console.log("🟩 OCR DONE, total chars:", finalText.length);

  return finalText.trim();
};

// 🔥 chiusura manuale per debug (non obbligatoria)
exports.closeOCR = async () => {
  if (workerInstance) {
    await workerInstance.terminate();
    workerInstance = null;
    console.log("🟥 OCR worker terminated");
  }
};
