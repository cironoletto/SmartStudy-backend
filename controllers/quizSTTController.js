const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

exports.stt = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Audio mancante" });
    }

    console.log("🎧 STT input:", req.file.path, req.file.mimetype);

    // 🔥 FIX CRITICO: aggiunge estensione .m4a
    const originalPath = req.file.path;
    const fixedPath = `${originalPath}.m4a`;

    fs.renameSync(originalPath, fixedPath);

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(fixedPath),
      model: "whisper-1",
      response_format: "json",
    });

    // cleanup
    fs.unlink(fixedPath, () => {});

    res.json({
      text: transcription.text || "",
    });
  } catch (err) {
    console.error("❌ STT BACKEND ERROR:", err);
    res.status(500).json({ error: "Errore trascrizione audio" });
  }
};
