const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const imageUpload = require("../middleware/upload");
const authMiddleware = require("../middleware/authMiddleware");

const quizFromOCRController = require("../controllers/quizFromOCRController");
const quizPlayController = require("../controllers/quizPlayController");
const quizSTTController = require("../controllers/quizSTTController");

const router = express.Router();

const audioDir = path.join(
  "uploads",
  "quiz-audio"
);

fs.mkdirSync(audioDir, {
  recursive: true,
});

const audioStorage =
  multer.diskStorage({
    destination: (
      _req,
      _file,
      callback
    ) => {
      callback(null, audioDir);
    },

    filename: (
      _req,
      file,
      callback
    ) => {
      const originalExtension =
        path.extname(
          file?.originalname || ""
        );

      const extension =
        originalExtension &&
        originalExtension.length <= 10
          ? originalExtension
              .toLowerCase()
          : ".m4a";

      callback(
        null,
        `${Date.now()}-${crypto.randomUUID()}${extension}`
      );
    },
  });

const audioUpload = multer({
  storage: audioStorage,

  limits: {
    fileSize:
      25 * 1024 * 1024,
    files: 1,
  },

  fileFilter: (
    _req,
    file,
    callback
  ) => {
    const mime =
      String(
        file?.mimetype || ""
      ).toLowerCase();

    if (
      !mime.startsWith("audio/") &&
      mime !==
        "application/octet-stream"
    ) {
      return callback(
        new Error(
          "INVALID_AUDIO_TYPE"
        ),
        false
      );
    }

    callback(null, true);
  },
});

function removeUploadedFiles(req) {
  const files = [];

  if (Array.isArray(req.files)) {
    files.push(...req.files);
  }

  if (req.file) {
    files.push(req.file);
  }

  for (const file of files) {
    try {
      if (
        file?.path &&
        fs.existsSync(file.path)
      ) {
        fs.unlinkSync(file.path);
      }
    } catch {}
  }
}

function handleMulterError(
  err,
  req,
  res,
  next
) {
  if (!err) {
    return next();
  }

  removeUploadedFiles(req);

  if (
    err instanceof
      multer.MulterError
  ) {
    if (
      err.code ===
      "LIMIT_FILE_SIZE"
    ) {
      return res.status(413).json({
        error: "FILE_TOO_LARGE",
        code: err.code,
        message:
          "Uno dei file supera la dimensione consentita.",
      });
    }

    if (
      err.code ===
      "LIMIT_FILE_COUNT"
    ) {
      return res.status(400).json({
        error: "TOO_MANY_FILES",
        code: err.code,
        message:
          "Sono stati inviati troppi file.",
      });
    }

    return res.status(400).json({
      error: "UPLOAD_ERROR",
      code: err.code,
      message: err.message,
    });
  }

  if (
    err?.message ===
    "INVALID_IMAGE_TYPE"
  ) {
    return res.status(400).json({
      error: "INVALID_IMAGE_TYPE",
      message:
        "Sono consentiti solo file immagine.",
    });
  }

  if (
    err?.message ===
    "INVALID_AUDIO_TYPE"
  ) {
    return res.status(400).json({
      error: "INVALID_AUDIO_TYPE",
      message:
        "Il file audio non è valido.",
    });
  }

  return res.status(400).json({
    error: "UPLOAD_ERROR",
    message:
      err?.message ||
      "Errore durante il caricamento.",
  });
}

const uploadQuizImages = (
  req,
  res,
  next
) => {
  imageUpload.array(
    "images",
    10
  )(
    req,
    res,
    (err) =>
      handleMulterError(
        err,
        req,
        res,
        next
      )
  );
};

const uploadQuizAudio = (
  req,
  res,
  next
) => {
  audioUpload.single(
    "audio"
  )(
    req,
    res,
    (err) =>
      handleMulterError(
        err,
        req,
        res,
        next
      )
  );
};

router.use(authMiddleware, require("../middleware/studyAccess"));

/* Rotte statiche: devono precedere quelle con :quizID. */
router.post(
  "/from-images",
  uploadQuizImages,
  quizFromOCRController.generateQuizFromImages
);

router.get(
  "/history",
  quizPlayController.getQuizHistory
);

router.post(
  "/stt",
  uploadQuizAudio,
  quizSTTController.stt
);

router.get(
  "/",
  quizPlayController.listUserQuizzes
);

router.get(
  "/:quizID/attempt/:attemptID",
  quizPlayController.getQuizAttemptDetail
);

router.get(
  "/:quizID/attempts",
  quizPlayController.getQuizAttempts
);

router.post(
  "/:quizID/attempts",
  quizPlayController.createAttempt
);

router.post(
  "/:quizID/attempt",
  quizPlayController.createAttempt
);

router.post(
  "/:quizID/attempts/:attemptID/answers",
  quizPlayController.submitAnswers
);

/* La rotta generica resta per ultima. */
router.get(
  "/:quizID",
  quizPlayController.getQuizDetail
);

module.exports = router;
