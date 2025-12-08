// controllers/legacyCreateQuizFromImage.js
const { extractTextFromImages } = require("./localOCR");
const quizModel = require("../models/quizModel");
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

exports.createQuizFromImage = async (req, res) => {
  try {
    const userID = req.user.userId;
    if (!req.file) return res.status(400).json({ error: "Nessuna immagine caricata" });

    const rawText = await extractTextFromImages([req.file]);

    const prompt = `
Genera un quiz in formato JSON:

{
  "title": "...",
  "description": "...",
  "questions": [
    {
      "type": "mcq" | "open",
      "text": "...",
      "choices": ["A","B","C","D"],
      "correctIndex": 1,
      "idealAnswer": "...",
      "points": 1
    }
  ]
}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: rawText }
      ]
    });

    const quizJson = JSON.parse(completion.choices[0].message.content);

    const quizID = await quizModel.createQuizWithQuestions({
      userID,
      title: quizJson.title,
      description: quizJson.description,
      questions: quizJson.questions
    });

    res.json({ quizID });
  } catch (err) {
    console.error("createQuizFromImage ERROR:", err);
    res.status(500).json({ error: err.message });
  }
};
