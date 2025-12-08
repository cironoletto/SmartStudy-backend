const upload = require("../middleware/upload");
const { saveNoteImage } = require("../models/quizModel");

async function uploadNote(req, res) {
  try {
    const userID = parseInt(req.body.userID);
    const filePath = req.file.path;

    await saveNoteImage(userID, filePath);

    res.json({
      message: "Immagine caricata con successo!",
      path: filePath,
    });
  } catch (err) {
    console.error("UPLOAD NOTE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { uploadNote, upload };
