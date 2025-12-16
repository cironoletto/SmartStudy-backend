const fs = require("fs");
const OpenAI = require("openai");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.stt = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Audio mancante" });
    }

    console.log("🎧 STT input:", req.file.path);

    const response = await openai.audio.transcriptions.create({
      file: fs.createReadStream(req.file.path),
      model: "gpt-4o-transcribe", // oppure whisper-1
    });

    const text = response.text || "";

    res.json({ text });
  } catch (err) {
    console.error("❌ STT BACKEND ERROR:", err);
    res.status(500).json({ error: "Errore trascrizione audio" });
  }
};
