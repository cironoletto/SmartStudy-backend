const multer = require("multer");
const path = require("path");
const fs = require("fs");

const uploadDir = "uploads/";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(
      null,
      Date.now() +
        "-" +
        Math.round(Math.random() * 1e9) +
        path.extname(file.originalname)
    );
  },
});

const upload = multer({
  storage,

  // 🔒 LIMITE DIMENSIONE (CRUCIALE PER RAILWAY)
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB per immagine
    files: 5, // max 5 immagini
  },

  // 🔒 SOLO IMMAGINI
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Solo immagini consentite"), false);
    }
    cb(null, true);
  },
});

module.exports = upload;
