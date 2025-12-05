const express = require('express');
const router = express.Router();
const { uploadNote, upload } = require('../controllers/notesController');

// Upload immagine singola
router.post('/upload', upload.single('image'), uploadNote);

module.exports = router;
