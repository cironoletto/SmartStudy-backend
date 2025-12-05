// routes/quizRoutes.js
const express = require("express");
const router = express.Router();

const upload = require("../middleware/upload");
const authMiddleware = require("../middleware/authMiddleware");

const quizFromOCRController = require("../controllers/quizFromOCRController");
const quizPlayController = require("../controllers/quizPlayController");

// Tutto richiede login
router.use(authMiddleware);

// --------------------------
// QUIZ OCR (Creazione quiz da immagini)
// --------------------------
router.post(
  "/from-images",
  upload.array("images", 10),
  quizFromOCRController.generateQuizFromImages
);

// --------------------------
// QUIZ – lista, dettaglio
// --------------------------
router.get("/", quizPlayController.listUserQuizzes);
router.get("/:quizID", quizPlayController.getQuizDetail);

// --------------------------
// TENTATIVI
// --------------------------
router.get("/:quizID/attempts", quizPlayController.getQuizAttempts);
router.post("/:quizID/attempts", quizPlayController.createAttempt);

// --------------------------
// RISPOSTE
// --------------------------
router.post(
  "/:quizID/attempts/:attemptID/answers",
  quizPlayController.submitAnswers
);

module.exports = router;






