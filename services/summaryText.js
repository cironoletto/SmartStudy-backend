const plainTextStyle =
  "Use plain text. Put short headings on their own lines without Markdown markers. " +
  "Use paragraphs and, only where useful, bullet points starting with •. " +
  "Do not use Markdown bold or heading syntax. Preserve meaningful symbols in formulas and code.";

function plainSummary(text) {
  if (typeof text !== "string") return text;
  let fence = "";
  return text.split(/\r?\n/).map(line => {
    const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (delimiter) {
      if (!fence) fence = delimiter[1];
      else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length) fence = "";
      return line;
    }
    if (fence || /^(?: {4}|\t)/.test(line)) return line;
    const heading = /^ {0,3}#{1,6}[ \t]+(?=\S)/;
    const body = heading.test(line)
      ? line.replace(heading, "").replace(/[ \t]+#+[ \t]*$/, "")
      : line;
    return body.replace(/^( {0,3})[-*][ \t]+(?=\S)/, "$1• ")
      .replace(/(`+)(.*?)\1|(?<![\w*\\])\*\*(?=\S)([^*]+?)(?<=\S)\*\*(?![\w*])/gu,
        (match, inlineCode, _code, bold) => inlineCode ? match : bold);
  }).join("\n");
}

module.exports = { plainSummary, plainTextStyle };
