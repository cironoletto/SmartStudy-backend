const test = require("node:test");
const assert = require("node:assert/strict");
const { plainSummary } = require("../services/summaryText");

test("English headings, dates and roles read naturally in the summary", () => {
  const source = "# Fire Drill\n\n## Exercise details\nOn **18/11/2026**.\n- **Fire Brigade Leaders:** A and B";
  const expected = "Fire Drill\n\nExercise details\nOn 18/11/2026.\n• Fire Brigade Leaders: A and B";
  assert.equal(plainSummary(source), expected);
  assert.equal(plainSummary(expected), expected);
});
test("Italian summaries, literal symbols and inline and fenced code", () => {
  assert.equal(plainSummary("## Ruoli ##\n**Responsabile:** Luca"), "Ruoli\nResponsabile: Luca");
  const text = "C# e #include, x**2, 3 * 4, `**bold**`\n```py\n## comment\na**b\n```";
  assert.equal(plainSummary(text), text);
  assert.equal(plainSummary(null), null);
});
