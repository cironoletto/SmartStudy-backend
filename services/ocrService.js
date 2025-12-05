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
  let finalText = "";

  for (const f of files) {
    const text = await ocrSingleImage(f.path);

    if (text.length > 3) {
      finalText += text + "\n\n";
    } else {
      console.log("⚠️ Nessun testo rilevante in:", f.path);
    }
  }

  return finalText.trim();
};

