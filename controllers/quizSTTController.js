const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

exports.stt = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "File audio mancante" });
    }

    const inputPath = req.file.path;               // .m4a
    const outputPath = `${inputPath}.wav`;          // .wav

    console.log("🎧 STT input:", inputPath);

    // 🔁 CONVERSIONE m4a → wav
    await new Promise((resolve, reject) => {
      exec(
        `ffmpeg -y -i "${inputPath}" -ar 16000 -ac 1 "${outputPath}"`,
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(outputPath),
      model: "gpt-4o-transcribe",
      response_format: "json",
    });

    // 🧹 cleanup
    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputPath);

    res.json({
      text: transcription.text || "",
    });
  } catch (err) {
    console.error("❌ STT BACKEND ERROR:", err);
    res.status(500).json({ error: "Errore trascrizione audio" });
  }
};
