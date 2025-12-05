const Tesseract = require('tesseract.js');
const path = require('path');
const fs = require('fs');
const { createQuiz, addQuestion, addAnswer } = require('../models/quizModel');

// Funzione robusta per il parsing del testo OCR in domande e risposte
function parseOCRTextToQuiz(text) {
  const questionRegex = /(?:Domanda\s*\d+[:.]?)([\s\S]*?)(?=(Domanda\s*\d+[:.]?|$))/gi;
  const questions = [];
  let match;

  while ((match = questionRegex.exec(text)) !== null) {
    const block = match[1].trim();
    const lines = block.split('\n').map(l => l.trim()).filter(l => l);

    if (lines.length === 0) continue;

    const qText = lines[0]; // prima linea = domanda
    const answers = [];

    for (let i = 1; i < lines.length; i++) {
      const aMatch = /^[a-d]\)\s*(.*)/i.exec(lines[i]);
      if (aMatch) {
        const answerText = aMatch[1].replace(/\*$/, '').trim();
        const isCorrect = /\*$/.test(aMatch[1]);
        answers.push({ text: answerText, isCorrect });
      }
    }

    if (answers.length > 0) questions.push({ text: qText, answers });
  }

  return questions;
}

async function createQuizFromImage(req, res) {
  if (!req.file) return res.status(400).json({ error: 'Nessuna immagine caricata' });

  try {
    const imagePath = path.resolve(req.file.path);

    // OCR con Tesseract.js, ignorando warning su file opzionali
    const { data: { text } } = await Tesseract.recognize(imagePath, 'ita', {
      logger: m => console.log(m), // log OCR in console
    });

    console.log('Testo OCR:', text);

    // Parsing domande/risposte
    const questions = parseOCRTextToQuiz(text);
    if (questions.length === 0) return res.status(400).json({ error: 'Nessuna domanda trovata nel testo OCR' });

    // Creazione quiz nel DB
    const quizID = await createQuiz('Quiz da foto', 'Quiz generato automaticamente da immagine');

    for (const q of questions) {
      const questionID = await addQuestion(quizID, q.text, imagePath);
      for (const a of q.answers) {
        await addAnswer(questionID, a.text, a.isCorrect);
      }
    }

    res.json({ message: 'Quiz creato dalla foto', quizID, questions });
  } catch (err) {
    console.error('Errore OCR/quiz:', err);
    res.status(500).json({ error: 'Impossibile creare quiz dalla foto: ' + err.message });
  } finally {
    // Opzionale: elimina immagine temporanea
    // fs.unlinkSync(req.file.path);
  }
}

module.exports = { createQuizFromImage };
