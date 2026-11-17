function intEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function getUsagePolicy(isPro) {
  return {
    quizDaily: isPro
      ? intEnv("PRO_QUIZ_DAILY_LIMIT", 20)
      : intEnv("FREE_QUIZ_DAILY_LIMIT", 2),

    studyDaily: isPro
      ? intEnv("PRO_STUDY_DAILY_LIMIT", 20)
      : intEnv("FREE_STUDY_DAILY_LIMIT", 2),

    oralDaily: isPro
      ? intEnv("PRO_ORAL_DAILY_LIMIT", 5)
      : intEnv("FREE_ORAL_DAILY_LIMIT", 1),

    quizSttDaily: isPro
      ? intEnv("PRO_QUIZ_STT_DAILY_LIMIT", 50)
      : intEnv("FREE_QUIZ_STT_DAILY_LIMIT", 10),

    quizMaxImages: intEnv("QUIZ_MAX_IMAGES", 5),
    studyMaxImages: intEnv("STUDY_MAX_IMAGES", 3),
  };
}

module.exports = { getUsagePolicy };
