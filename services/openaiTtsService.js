const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MAX_CHARS = 5000; // limite di sicurezza costi

async function generateSummaryAudio(text, sessionID) {
  if (!process.env.OPENAI_API_KEY) {
    console.warn("⚠️ OPENAI_API_KEY non impostata");
    return null;
  }

  if (!text || !text.trim()) return null;

  // Limite caratteri (anti-cost explosion)
  const safeText = text.slice(0, MAX_CHARS);

  const outDir = path.join(__dirname, "..", "audio");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const fileName = `study_session_${sessionID}.mp3`;
  const filePath = path.join(outDir, fileName);

  // Cache: se esiste già, non rigenerare
  if (fs.existsSync(filePath)) {
    return `/audio/${fileName}`;
  }

  try {
    const response = await client.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: safeText,
      format: "mp3",
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(filePath, buffer);

    const publicUrl = `/audio/${fileName}`;
    console.log("🎧 OpenAI TTS generato:", publicUrl);

    return publicUrl;

  } catch (err) {
    console.error("❌ OpenAI TTS error:", err.message || err);
    return null;
  }
}

module.exports = {
  generateSummaryAudio,
};
