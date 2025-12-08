// controllers/questionImageController.js

const { addQuestion } = require("../models/quizModel");

async function addQuestionWithImage(req, res) {
  try {
    const quizID = parseInt(req.body.quizID);
    const questionText = req.body.questionText;
    const filePath = req.file.path;

    const questionID = await addQuestion(quizID, questionText, filePath);

    res.json({
      message: "Domanda creata con immagine",
      questionID,
      image: filePath,
    });
  } catch (err) {
    console.error("ADD QUESTION IMAGE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { addQuestionWithImage };
