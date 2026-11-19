console.log("USING quizFromOCRController.js VERSION PG");
const fs = require("fs");
const OpenAI = require("openai");
const { extractTextFromImages } = require("./localOCR");
const quizModel = require("../models/quizModel");
const {
  checkLimit,
} = require("../services/usageLimitService");
const { getSubscriptionStatus } = require("../services/subscriptionService");
const { getUsagePolicy } = require("../services/usagePolicy");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-6-luna";

const QUIZ_SYSTEM_PROMPT = `
Sei un generatore di quiz scolastici.

REGOLE OBBLIGATORIE:
- Genera ALMENO 5 domande.
- Ogni domanda MCQ deve avere ESATTAMENTE 4 scelte in "choices".
- "correctIndex" deve essere 0..3.
- Non restituire mai "questions" vuoto.
- Se il testo OCR e poco chiaro, genera domande generiche ma coerenti con l'argomento rilevabile.

RISPONDI SOLO CON JSON:
{
  "title": "Titolo del quiz",
  "description": "Breve descrizione",
  "questions": [
    {
      "type": "mcq",
      "text": "Domanda",
      "choices": ["A", "B", "C", "D"],
      "correctIndex": 0,
      "points": 1
    },
    {
      "type": "open",
      "text": "Domanda aperta",
      "idealAnswer": "Risposta ideale",
      "points": 1
    }
  ]
}`;

function normalizeQuizJson(quizJson) {
  const title = quizJson?.title || "Quiz generato";
  const description = quizJson?.description || "";
  let questions = Array.isArray(quizJson?.questions) ? quizJson.questions : [];

  const hasOpen = questions.some(q => q?.type === "open");
  if (!hasOpen && questions.length > 0) {
    questions.push({
      type: "open",
      text: "Spiega con parole tue l'argomento principale del quiz.",
      idealAnswer: "",
      points: 1,
    });
  }

  questions = questions.map(q => {
    const type = q?.type || "mcq";

    if (type === "mcq") {
      const choices = Array.isArray(q?.choices)
        ? q.choices
        : Array.isArray(q?.options)
          ? q.options
          : [];

      return {
        type: "mcq",
        text: String(q?.text || "").trim(),
        choices: choices.slice(0, 4),
        correctIndex: Number.isInteger(q?.correctIndex) ? q.correctIndex : 0,
        points: Number.isFinite(q?.points) ? q.points : 1,
      };
    }

    return {
      type: "open",
      text: String(q?.text || "").trim(),
      idealAnswer: String(q?.idealAnswer || "").trim(),
      points: Number.isFinite(q?.points) ? q.points : 1,
    };
  });

  questions = questions.filter(q => q.text && q.text.length >= 3);

  if (questions.length < 5) {
    throw new Error("QUIZ_TOO_FEW_VALID_QUESTIONS");
  }

  questions = questions.map(q => {
    if (q.type !== "mcq") return q;

    let idx = Number.isInteger(q.correctIndex) ? q.correctIndex : 0;
    idx = Math.max(0, Math.min(3, idx));

    const padded = [...(Array.isArray(q.choices) ? q.choices : [])];
    while (padded.length < 4) padded.push(`Opzione ${padded.length + 1}`);

    return { ...q, choices: padded.slice(0, 4), correctIndex: idx };
  });

  return { title, description, questions };
}

exports.generateQuizFromImages = async (req, res) => {
  try {
    const userID = req.user?.userId;
    if (!userID) return res.status(401).json({ error: "Utente non autenticato" });

  const files = req.files || [];

const requestID = String(
  req.body?.requestID || ""
)
  .trim()
  .slice(0, 100);

const subscription =
  await getSubscriptionStatus(
    userID
  );

const policy =
  getUsagePolicy(
    subscription.isPro
  );

/* ---------------------------------------------------------
   RETRY IDEMPOTENTE
   Se il quiz esiste già, non rifare OCR/OpenAI
--------------------------------------------------------- */
if (requestID) {
  const existingQuiz =
    await quizModel.getQuizByRequestID(
      userID,
      requestID
    );

  if (existingQuiz) {
    // Le immagini sono già state caricate da multer:
    // eliminiamo i file temporanei.
    for (const file of files) {
      try {
        fs.unlinkSync(file.path);
      } catch {}
    }

    const currentLimit =
      await checkLimit(
        userID,
        "quiz_sessions",
        policy.quizDaily
      );

    return res.json({
      quizID:
        existingQuiz.quizID,

      title:
        existingQuiz.title,

      description:
        existingQuiz.description,

      questions:
        existingQuiz.questions,

      isPro:
        subscription.isPro,

      limit:
        policy.quizDaily,

      remaining:
        Math.max(
          0,
          Number(
            currentLimit.remaining ||
              0
          )
        ),

      reused: true,
    });
  }
}

if (!files.length) {
  return res.status(400).json({
    error:
      "Nessuna immagine ricevuta",
  });
}

    if (files.length > policy.quizMaxImages) {
      return res.status(400).json({
        error: "IMAGE_LIMIT_EXCEEDED",
        limit: policy.quizMaxImages,
      });
    }

    const limitCheck = await checkLimit(userID, "quiz_sessions", policy.quizDaily);
    if (!limitCheck.allowed) {
      return res.status(403).json({
        error: "LIMIT_EXCEEDED",
        feature: "quiz_sessions",
        limit: policy.quizDaily,
        remaining: 0,
        isPro: subscription.isPro,
        reset: "domani",
      });
    }

    let rawText = "";

    for (const file of files) {
      try {
        const text = await extractTextFromImages([file]);
        rawText += "\n" + (text || "");
      } catch (e) {
        console.warn("OCR failed:", file.filename || file.originalname);
      } finally {
        try { fs.unlinkSync(file.path); } catch {}
      }
    }

    if (!rawText || rawText.trim().length < 10) {
      return res.status(400).json({
        error: "OCR_TEXT_TOO_SHORT",
        message: "Il testo nelle immagini non e abbastanza leggibile.",
      });
    }

    const truncatedText = rawText.slice(0, 10000);

    const completion = await openai.chat.completions.create({
      model: TEXT_MODEL,
      reasoning_effort: "none",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: QUIZ_SYSTEM_PROMPT },
        { role: "user", content: `Testo OCR:\n${truncatedText}` },
      ],
      temperature: 0.3,
    });

    const quizJson = JSON.parse(completion.choices[0].message.content);
    const normalized = normalizeQuizJson(quizJson);

    const quizID =
  await quizModel.createQuizWithQuestions({
    userID,
    title: normalized.title,
    description:
      normalized.description,
    questions:
      normalized.questions,
    requestID:
      requestID || null,
  });

  const savedQuiz =
  requestID
    ? await quizModel.getQuizByRequestID(
        userID,
        requestID
      )
    : null;

return res.json({
  quizID,

  title:
    savedQuiz?.title ??
    normalized.title,

  description:
    savedQuiz?.description ??
    normalized.description,

  questions:
    savedQuiz?.questions ??
    normalized.questions,

  isPro:
    subscription.isPro,

  limit:
    policy.quizDaily,

  remaining:
    Math.max(
      0,
      Number(
        limitCheck.remaining || 0
      ) - 1
    ),
});
  } catch (err) {
    console.error("OCR QUIZ ERROR:", err);
    return res.status(500).json({ error: "Errore durante la generazione del quiz" });
  }
};
