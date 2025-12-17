const express = require("express");
const router = express.Router();

const imageUpload = require("../middleware/upload"); // 🔥 SOLO IMMAGINI
const authMiddleware = require("../middleware/authMiddleware");

const quizFromOCRController = require("../controllers/quizFromOCRController");
const quizPlayController = require("../controllers/quizPlayController");
const quizSTTController = require("../controllers/quizSTTController");

// 🎤 multer SOLO per audio STT
const multer = require("multer");
const audioUpload = multer({ dest: "uploads/" });


// Tutto richiede login
router.use(authMiddleware);

// --------------------------
// QUIZ OCR (Creazione quiz da immagini)
// --------------------------
router.post(
  "/from-images",
  imageUpload.array("images", 10),
  quizFromOCRController.generateQuizFromImages
);

// CRONOLOGIA QUIZ (DB)
router.get("/history", quizPlayController.getQuizHistory);
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

// ✅ alias legacy (puoi tenerlo)
router.post("/:quizID/attempt", quizPlayController.createAttempt);

// --------------------------
// RISPOSTE
// --------------------------
router.post(
  "/:quizID/attempts/:attemptID/answers",
  quizPlayController.submitAnswers
);

// --------------------------
// 🎤 SPEECH TO TEXT (QUIZ)
// --------------------------
router.post(
  "/stt",
  audioUpload.single("audio"),
  quizSTTController.stt
);

module.exports = router;





