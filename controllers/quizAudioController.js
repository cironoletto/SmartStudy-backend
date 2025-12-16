const { API_URL } = process.env;

exports.uploadAnswerAudio = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Nessun audio ricevuto" });

    // Se il tuo upload middleware salva in /uploads, fai così:
    const audioUrl = `/uploads/${req.file.filename}`;

    return res.json({ audioUrl });
  } catch (err) {
    console.error("uploadAnswerAudio error:", err);
    res.status(500).json({ error: "Errore upload audio" });
  }
};
