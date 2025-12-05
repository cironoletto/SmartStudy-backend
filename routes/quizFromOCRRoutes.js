// routes/quizFromOCRRoutes.js
const express = require("express");
const multer = require("multer");
const router = express.Router();
const quizController = require("../controllers/quizFromOCRController");

// cartella upload (temporanea)
const upload = multer({ dest: "uploads/" });

// POST /api/quiz/from-images
router.post(
  "/from-images",
  upload.array("files", 10), // nome campo = "files"
  quizController.generateQuizFromImages
);

module.exports = router;

