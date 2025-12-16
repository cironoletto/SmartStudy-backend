const fs = require("fs");
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

exports.stt = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Nessun file audio" });
    }

    const filePath = req.file.path;

    const transcript = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: "gpt-4o-transcribe",
    });

    fs.unlinkSync(filePath); // cleanup

    res.json({
      text: transcript.text || "",
    });
  } catch (err) {
    console.error("❌ STT BACKEND ERROR:", err);
    res.status(500).json({ error: "Errore trascrizione audio" });
  }
};
