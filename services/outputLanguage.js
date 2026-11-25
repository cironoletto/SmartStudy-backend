function outputLanguage(req, summary = false) {
  if (summary && req.body?.summaryLanguage === "source") {
    return "Write the entire summary, including headings, in the predominant language of the source material.";
  }
  const english = (summary && req.body?.summaryLanguage === "en") ||
    /^en(?:[-,;]|$)/i.test(req.headers?.["accept-language"] || "");
  return "Write all student-facing text in " + (english ? "English" : "Italian") +
    ". Preserve JSON field names, identifiers, formulas and code.";
}
module.exports = outputLanguage;
