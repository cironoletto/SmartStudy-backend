const upload = require('../middleware/upload');
const { saveNoteImage } = require('../models/quizModel');

async function uploadNote(req, res) {
    try {
        const userID = parseInt(req.body.userID);
        const filePath = req.file.path; // percorso file salvato
        await saveNoteImage(userID, filePath);
        res.json({ message: 'Immagine caricata con successo!', path: filePath });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

module.exports = { uploadNote, upload };
