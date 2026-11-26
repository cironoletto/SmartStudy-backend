const focus = new Map([
  ["Matematica", "definizioni, rigore dei passaggi e giustificazione dei risultati"],
  ["Fisica", "leggi, relazioni tra grandezze e unità di misura"],
  ["Italiano", "comprensione del testo, interpretazione e lessico"],
  ["Inglese", "comprensione, coerenza e uso del lessico inglese quando la risposta è in inglese"],
  ["Storia", "cronologia, contesto e rapporti di causa ed effetto"],
  ["Scienze", "processi, evidenze e terminologia scientifica"],
  ["Informatica", "logica, algoritmi e precisione dei concetti"],
  ["Altro", "concetti principali, chiarezza e lessico del materiale"],
]);

function subjectInstruction(subject) {
  return focus.has(subject)
    ? ` Materia: ${subject}. Concentrati su ${focus.get(subject)}, solo se pertinenti agli appunti. Non giudicare pronuncia o accento da una trascrizione. Mantieni la lingua di risposta richiesta.`
    : "";
}
module.exports = { subjectInstruction, supportedSubject: subject => focus.has(subject) };
