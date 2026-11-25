const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const studyController = require("../controllers/studyController");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

const studyImageDir = path.join(
  require("os").tmpdir(), "smartstudy-uploads",
  "study"
);

const studyAudioDir = path.join(
  require("os").tmpdir(), "smartstudy-uploads",
  "audio"
);

fs.mkdirSync(studyImageDir, {
  recursive: true,
});

fs.mkdirSync(studyAudioDir, {
  recursive: true,
});

function extensionFor(
  file,
  fallback
) {
  const originalExtension =
    path.extname(
      file?.originalname || ""
    );

  if (
    originalExtension &&
    originalExtension.length <= 10
  ) {
    return originalExtension
      .toLowerCase();
  }

  return fallback;
}

function createStorage(
  destination,
  fallbackExtension
) {
  return multer.diskStorage({
    destination: (
      _req,
      _file,
      callback
    ) => {
      callback(
        null,
        destination
      );
    },

    filename: (
      _req,
      file,
      callback
    ) => {
      const extension =
        extensionFor(
          file,
          fallbackExtension
        );

      callback(
        null,
        `${Date.now()}-${crypto.randomUUID()}${extension}`
      );
    },
  });
}

const imageUpload = multer({
  storage: createStorage(
    studyImageDir,
    ".jpg"
  ),

  limits: {
    fileSize:
      15 * 1024 * 1024,
    files: 10,
  },

  fileFilter: (
    _req,
    file,
    callback
  ) => {
    if (
      !file?.mimetype
        ?.startsWith("image/")
    ) {
      return callback(
        new Error(
          "INVALID_IMAGE_TYPE"
        ),
        false
      );
    }

    callback(null, true);
  },
});

const audioUpload = multer({
  storage: createStorage(
    studyAudioDir,
    ".m4a"
  ),

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

    const allowed =
      mime.startsWith("audio/") ||
      mime ===
        "application/octet-stream";

    if (!allowed) {
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

function multerErrorResponse(
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

const uploadStudyImages = (
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
      multerErrorResponse(
        err,
        req,
        res,
        next
      )
  );
};

const uploadOralAudio = (
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
      multerErrorResponse(
        err,
        req,
        res,
        next
      )
  );
};

router.get("/stats", authMiddleware, studyController.getStudyStats);

router.use(authMiddleware, require("../middleware/studyAccess"));

router.post(
  "/from-images",
  uploadStudyImages,
  studyController.processFromImages
);

router.post(
  "/scientific/explain-step",
  studyController.explainScientificStep
);

router.post(
  "/evaluate-oral",
  uploadOralAudio,
  studyController.evaluateOral
);

router.get(
  "/sessions",
  studyController.getStudySessions
);

router.get(
  "/session/:sessionID",
  studyController.getStudySession
);

router.get(
  "/oral/:sessionID",
  studyController.getOralStudyDetail
);

router.post(
  "/session/:sessionID/rating",
  studyController.setRating
);

router.get(
  "/stats/global",
  studyController.getGlobalStats
);



module.exports = router;
