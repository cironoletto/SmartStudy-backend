// controllers/ocrController.js

const { createWorker } = require("tesseract.js");

// ----------------------------------------------------------------------------
// ❗ IMPORTANTE
// Tesseract.js supporta solo "eng" senza installare modelli extra.
// Per ora usiamo eng ma applichiamo ottimizzazioni.
// ----------------------------------------------------------------------------

// Timeout helper
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("OCR TIMEOUT")), ms)
    ),
  ]);
}

// SINGLETON WORKER — veloce, non crea 10 processi
let workerInstance = null;

async function getWorker() {
  if (!workerInstance) {
    console.log("🟦 OCR: Creating worker (eng)...");
    workerInstance = await createWorker("eng");
  }
  return workerInstance;
}

async function extractImage(path) {
  try {
    const worker = await getWorker();

    const { data } = await withTimeout(worker.recognize(path), 15000);

    return data.text || "";
  } catch (err) {
    console.error("⚠️ OCR ERROR:", err.message);
    return "";
  }
}

// ----------------------------------------------------------------------------
// 📸 OCR API Route
// ----------------------------------------------------------------------------
async function extractTextFromImage(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Nessuna immagine caricata" });
    }

    const imagePath = req.file.path;

    console.log("📸 OCR su:", imagePath);

    const text = await extractImage(imagePath);

    res.json({
      message: "OCR completato",
      extractedText: text,
      image: imagePath,
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = { extractTextFromImage };
