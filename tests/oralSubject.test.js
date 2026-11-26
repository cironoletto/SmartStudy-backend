const test = require("node:test");
const assert = require("node:assert/strict");
const { supportedSubject, subjectInstruction } = require("../services/oralSubject");
const outputLanguage = require("../services/outputLanguage");

test("Italian and English feedback are independent of the selected discipline", () => {
  for (const subject of ["Matematica", "Fisica", "Italiano", "Inglese", "Storia", "Scienze", "Informatica", "Altro"]) {
    assert.equal(supportedSubject(subject), true);
    for (const [locale, language] of [["it", "Italian"], ["en", "English"]]) {
      const prompt = outputLanguage({ headers: { "accept-language": locale } }) + subjectInstruction(subject);
      assert.ok(prompt.includes(language) && prompt.includes("Materia: " + subject));
    }
  }
});
test("old uncategorised sessions and arbitrary subjects do not add instructions", () => {
  for (const subject of [undefined, null, "", "Studio", "other instructions"]) {
    assert.equal(supportedSubject(subject), false);
    assert.equal(subjectInstruction(subject), "");
  }
});
