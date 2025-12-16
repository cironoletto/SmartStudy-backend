const fs = require("fs");
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

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(req.file.path),
      model: "whisper-1", // ✅ MODELLO CORRETTO
      response_format: "json",
    });

    const text = transcription.text || "";

    res.json({ text });
  } catch (err) {
    console.error("❌ STT BACKEND ERROR:", err);
    res.status(500).json({ error: "Errore trascrizione audio" });
  }
};
