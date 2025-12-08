// controllers/localOCR.js
// controllers/localOCR.js
const { createWorker } = require("tesseract.js");

/* ----------------------------------------------
   ⏳ Promise Timeout Helper
---------------------------------------------- */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("OCR TIMEOUT")), ms)
    ),
  ]);
}

/* ----------------------------------------------
   🔥 SINGLETON WORKER (eng)
---------------------------------------------- */
let workerInstance = null;
let workerBusy = false;

async function getWorker() {
  if (!workerInstance) {
    console.log("🟦 OCR: starting worker (eng)...");
    workerInstance = await createWorker("eng");
  }
  return workerInstance;
}

/* ----------------------------------------------
   📸 OCR for a single image (with retry)
---------------------------------------------- */
async function extractTextFromImage(filePath) {
  let attempt = 1;

  while (attempt <= 2) {
    try {
      const worker = await getWorker();

      const { data } = await withTimeout(
        worker.recognize(filePath),
        15000 // 15 seconds timeout per image
      );

      return data.text || "";

    } catch (err) {
      console.error(`⚠️ OCR ERROR (attempt ${attempt}) on`, filePath, err.message);

      // retry once
      if (attempt === 1) {
        attempt++;
        continue;
      }

      return ""; // fallback
    }
  }
}

/* ----------------------------------------------
   🧩 OCR for multiple images
---------------------------------------------- */
exports.extractTextFromImages = async (files) => {
  let resultText = "";

  for (const f of files) {
    const text = await extractTextFromImage(f.path);
    resultText += "\n" + text;
  }

  console.log("🟩 OCR COMPLETED → chars:", resultText.length);

  return resultText.trim();
};

/* ----------------------------------------------
   🧹 Close worker (optional)
---------------------------------------------- */
exports.closeOCR = async () => {
  if (workerInstance) {
    console.log("🟥 Shutting down OCR worker...");
    await workerInstance.terminate();
    workerInstance = null;
  }
};
