// services/elevenlabsService.js
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const ELEVEN_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVEN_VOICE_ID = process.env.ELEVENLABS_VOICE_ID; // es: "pNInz6obpgDQGcFmaJgB"

if (!ELEVEN_API_KEY) {
  console.warn("⚠️ ELEVENLABS_API_KEY non impostata in .env");
}
if (!ELEVEN_VOICE_ID) {
  console.warn("⚠️ ELEVENLABS_VOICE_ID non impostata in .env");
}

async function generateSummaryAudio(text, sessionID) {
  if (!ELEVEN_API_KEY || !ELEVEN_VOICE_ID) {
    console.warn("❌ ElevenLabs non configurato, salto generazione audio");
    return null;
  }

  try {
    const outDir = path.join(__dirname, "..", "audio");
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const fileName = `study_session_${sessionID}.mp3`;
    const filePath = path.join(outDir, fileName);

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE_ID}`;

    const response = await axios({
      method: "post",
      url,
      data: {
        text,
        model_id: "eleven_turbo_v2_5", // modello veloce / di qualità
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.8,
        },
      },
      headers: {
        "xi-api-key": ELEVEN_API_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      responseType: "arraybuffer",
      timeout: 60000,
    });

    fs.writeFileSync(filePath, response.data);

    // URL pubblico servito da Express (vedi passo 4)
    const publicUrl = `/audio/${fileName}`;
    console.log("✅ Audio ElevenLabs generato:", publicUrl);

    return publicUrl;
  } catch (err) {
    console.error("❌ Errore ElevenLabs TTS:", err.message || err);
    return null;
  }
}

module.exports = {
  generateSummaryAudio,
};
