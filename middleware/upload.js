const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const uploadDir = path.join(
  "uploads",
  "quiz"
);

fs.mkdirSync(uploadDir, {
  recursive: true,
});

const storage = multer.diskStorage({
  destination: (
    _req,
    _file,
    callback
  ) => {
    callback(null, uploadDir);
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
        : ".jpg";

    callback(
      null,
      `${Date.now()}-${crypto.randomUUID()}${extension}`
    );
  },
});

const upload = multer({
  storage,

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

module.exports = upload;
