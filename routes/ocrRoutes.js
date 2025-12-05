// backend/routes/ocrRoutes.js
const express = require("express");
const multer = require("multer");
const router = express.Router();
const quizFromOCRController = require("../controllers/quizFromOCRController");

// cartella uploads
const upload = multer({ dest: "uploads/" });

// POST /api/ocr/quiz/from-images
router.post(
  "/quiz/from-images",
  upload.array("images", 20), // NOME CAMPO = "images"
  quizFromOCRController.generateQuizFromImages
);

module.exports = router;

