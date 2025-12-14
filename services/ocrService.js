//-------------------------------------------------------------
// 🚀 OCR SERVICE – Versione potenziata con Sharp + Debug
//-------------------------------------------------------------
const tesseract = require("node-tesseract-ocr");
const path = require("path");
const sharp = require("sharp"); // ⚠️ ASSICURATI DI INSTALLARLO: npm install sharp

// Configurazione Tesseract ottimizzata
const baseConfig = {
  lang: "ita+eng+fra+spa+deu",
  oem: 1,
  psm: 6, // più stabile per testi da foto
};

//-------------------------------------------------------------
// 🧼 PREPROCESSING: migliora contrasto e leggibilità
//-------------------------------------------------------------
async function preprocessImage(inputPath) {
  const processedPath = inputPath + "_proc.jpg";

  try {
    console.log("🖼 PREPROCESSING:", inputPath);

    await sharp(inputPath)
      .grayscale()       // converte in bianco e nero
      .normalize()       // aumenta contrasto
      .sharpen()         // nitidezza delle scritte
      .toFile(processedPath);

    return processedPath;

  } catch (err) {
    console.log("⚠️ SHARP ERROR:", err);
    return inputPath; // fallback
  }
}

//-------------------------------------------------------------
// 🔍 OCR Singola Immagine
//-------------------------------------------------------------
async function ocrSingleImage(filePath) {
  try {
    console.log("📄 OCR → Analizzo:", filePath);

    // Preprocess la foto
    const processed = await preprocessImage(filePath);

    // OCR
    const text = await tesseract.recognize(processed, baseConfig);

    console.log("🔍 OCR OUTPUT:", JSON.stringify(text));

    return text.trim();

  } catch (err) {
    console.error("❌ OCR ERROR:", err);
    return "";
  }
}

//-------------------------------------------------------------
// 🔥 OCR MULTI-IMMAGINE
//-------------------------------------------------------------
exports.extractTextFromImages = async (files) => {
  try {
    if (!Array.isArray(files) || files.length === 0) return "";

    let finalText = "";

    for (const f of files) {
      console.log("📦 FILE:", { path: f.path, size: f.size, mimetype: f.mimetype });

      const text = await ocrSingleImage(f.path);

      if (text && text.trim()) {
        finalText += text.trim() + "\n\n";
      } else {
        console.log("⚠️ OCR vuoto per:", f.path);
      }
    }

    return (finalText || "").trim();
  } catch (err) {
    console.error("❌ extractTextFromImages ERROR:", err);
    return ""; // 🔥 mai undefined/null
  }
};


