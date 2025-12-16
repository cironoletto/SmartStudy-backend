const fs = require("fs");
const path = require("path");
const { transcribeAudio } = require("./studyController"); 
// ⬆️ importa ESATTAMENTE il file dove sta la tua funzione

exports.quizSpeechToText = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Nessun audio ricevuto" });
    }

    const audioPath = req.file.path;

    const text = await transcribeAudio(audioPath);

    // 🔥 pulizia file temporaneo
    fs.unlink(audioPath, () => {});

    res.json({ text });
  } catch (err) {
    console.error("❌ QUIZ STT ERROR:", err);
    res.status(500).json({ error: "Errore trascrizione audio" });
  }
};
