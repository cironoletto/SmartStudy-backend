// Legacy compatibility wrapper. The active implementation is quizFromOCRController.
const { generateQuizFromImages } = require("./quizFromOCRController");
exports.createQuizFromImage = generateQuizFromImages;
