const express = require("express");
const router = express.Router();
const multer = require("multer");

const studyController = require("../controllers/studyController");
const authMiddleware = require("../middleware/authMiddleware");

/* ------------------------------
   📌 MULTER STORAGE PERSONALIZZATO
   —– Salva file con estensione corretta!
------------------------------- */
const storage = multer.diskStorage({
  destination: "uploads/study/",
  filename: (req, file, cb) => {
    // Estrae estensione originale (m4a, mp3, wav…)
    const ext = file.originalname.split(".").pop();
    const filename = Date.now() + "." + ext;
    cb(null, filename);
  },
});

// Multer aggiornato
const upload = multer({ storage });

/* -----------------------------------------
   📸 OCR + AI (Study Mode)
----------------------------------------- */
router.post(
  "/from-images",
  authMiddleware,
  upload.array("images", 10),
  studyController.processFromImages
);

/* -----------------------------------------
   🧠 Spiegazione singolo passaggio scientifico
----------------------------------------- */
router.post(
  "/scientific/explain-step",
  authMiddleware,
  studyController.explainScientificStep
);

/* -----------------------------------------
   🎙 VALUTAZIONE ORALE
----------------------------------------- */
router.post(
  "/evaluate-oral",
  authMiddleware,
  upload.single("audio"),
  studyController.evaluateOral
);

/* -----------------------------------------
   📚 Cronologia Sessioni
----------------------------------------- */
router.get("/sessions", authMiddleware, studyController.getStudySessions);
router.get("/session/:sessionID", authMiddleware, studyController.getStudySession);
router.get("/oral/:sessionID", authMiddleware, studyController.getOralStudyDetail);

/* -----------------------------------------
   ⭐ Rating Sessione
----------------------------------------- */
router.post("/session/:sessionID/rating", authMiddleware, studyController.setRating);

/* -----------------------------------------
   📊 Statistiche
----------------------------------------- */
router.get("/stats/global", authMiddleware, studyController.getGlobalStats);
router.get("/stats", authMiddleware, studyController.getStudyStats);

module.exports = router;
