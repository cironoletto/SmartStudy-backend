//-------------------------------------------------------------
// 🚀 OCR SERVICE – SAFE (ANTI-OOM)
//-------------------------------------------------------------
const tesseract = require("node-tesseract-ocr");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");

//-------------------------------------------------------------
// ⚙️ Tesseract config (LOW MEMORY)
//-------------------------------------------------------------
const baseConfig = {
  lang: "ita+eng+fra+spa+deu",
  oem: 1,
  psm: 6,
};

//-------------------------------------------------------------
// 🧼 PREPROCESS (RIDOTTO + SAFE)
//-------------------------------------------------------------
async function preprocessImage(inputPath) {
  const processedPath = inputPath + "_proc.jpg";

  try {
    await sharp(inputPath)
      .resize({ width: 1600, withoutEnlargement: true }) // 🔥 FIX OOM
      .grayscale()
      .normalize()
      .sharpen(0.5)
      .jpeg({ quality: 85 })
      .toFile(processedPath);

    return processedPath;
  } catch (err) {
    console.warn("⚠️ Sharp preprocess failed:", err.message);
    return inputPath; // fallback
  }
}

//-------------------------------------------------------------
// 🔍 OCR SINGOLA IMMAGINE (SAFE)
//-------------------------------------------------------------
async function ocrSingleImage(filePath) {
  let processed = null;

  try {
    processed = await preprocessImage(filePath);

    const text = await tesseract.recognize(processed, baseConfig);

    return (text || "").trim();
  } catch (err) {
    console.error("❌ OCR ERROR:", err.message);
    return "";
  } finally {
    // 🧹 DELETE FILE PREPROCESSATO
    if (processed && processed !== filePath) {
      try { fs.unlinkSync(processed); } catch {}
    }
  }
}

//-------------------------------------------------------------
// 🔥 OCR MULTI-IMMAGINE (SEQUENZIALE)
//-------------------------------------------------------------
exports.extractTextFromImages = async (files = []) => {
  let finalText = "";

  for (const f of files) {
    try {
      const text = await ocrSingleImage(f.path);
      if (text) finalText += text + "\n\n";
    } catch {}
  }

  return finalText.trim();
};
