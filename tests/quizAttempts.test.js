// Run without installing packages: node --test tests/quizAttempts.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {
  QuizAttemptError, positiveId, scoreAnswers, createQuizAttemptService,
} = require("../services/quizAttemptService");

const questions = [
  { questionid: 1, questiontext: "Uno?", questiontype: "mcq", choicesjson: '["A","B"]', correctanswer: "0", points: 1 },
  { questionid: 2, questiontext: "Due?", questiontype: "mcq", choicesjson: '["C","D"]', correctanswer: "1", points: 1 },
];
const full = [{ questionID: 1, selectedIndex: 0 }, { questionID: 2, selectedIndex: 1 }];
const status = code => error => error instanceof QuizAttemptError && error.status === code;

test("partial answers count against the full quiz, including a stored empty answer", () => {
  const result = scoreAnswers(questions, full.slice(0, 1));
  assert.equal(result.totalScore, 1);
  assert.equal(result.maxScore, 2);
  assert.equal(result.isPassed, false);
  assert.equal(result.details[1].userAnswer, "");
  assert.equal(result.details[1].score, 0);
});

test("empty submission scores zero rather than producing a false pass", () => {
  const result = scoreAnswers(questions, []);
  assert.equal(result.totalScore, 0);
  assert.equal(result.maxScore, 2);
  assert.equal(result.isPassed, false);
});

test("weighted points, zero points and the existing 60% pass threshold", () => {
  const weighted = [{ ...questions[0], points: 3 }, { ...questions[1], points: 2 }];
  assert.equal(scoreAnswers(weighted, full.slice(0, 1)).isPassed, true);
  assert.equal(scoreAnswers([{ ...questions[0], points: 0 }], full.slice(0, 1)).maxScore, 0);
  assert.equal(scoreAnswers([{ ...questions[0], points: 0 }], full.slice(0, 1)).isPassed, false);
});

test("open questions retain case insensitive exact match and reject non-text input", () => {
  const q = [{ questionid: 3, questiontype: "open", correctanswer: " Roma ", points: 2 }];
  assert.equal(scoreAnswers(q, [{ questionID: 3, answerText: " ROMA " }]).totalScore, 2);
  assert.equal(scoreAnswers(q, [{ questionID: 3, answerText: "Milano" }]).totalScore, 0);
  assert.throws(() => scoreAnswers(q, [{ questionID: 3, answerText: {} }]), status(400));
});

test("duplicate, foreign and malformed answers are rejected", () => {
  for (const answers of [[full[0], full[0]], [{ questionID: 30 }], [null], {}, [{ questionID: 1, selectedIndex: "0" }], [{ questionID: 1, selectedIndex: -1 }], [{ questionID: 1, selectedIndex: 2 }], [{ questionID: 1, audioUrl: {} }]]) {
    assert.throws(() => scoreAnswers(questions, answers), status(400));
  }
});

test("strict IDs reject coercible and partially numeric values", () => {
  assert.equal(positiveId("10"), 10);
  for (const value of ["1junk", "1.0", "1e2", true, [], null, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => positiveId(value), status(400));
  }
});

test("empty or corrupt quizzes cannot complete a valid attempt", () => {
  assert.throws(() => scoreAnswers([], []), status(409));
  assert.throws(() => scoreAnswers([{ ...questions[0], points: -1 }], []));
  assert.throws(() => scoreAnswers([{ ...questions[0], correctanswer: null }], []));
  assert.throws(() => scoreAnswers([{ ...questions[0], choicesjson: "[]" }], []));
});

// Transactional DB double. It checks the SQL contract and simulates rollback/row locks.
// It does not replace running these queries against the real PostgreSQL schema.
function fixture(options = {}) {
  const state = {
    attempt: { attemptid: 90, quizid: 3, userid: 7, completedat: null },
    quizOwner: 7, answers: [], calls: [], released: 0, ...options,
  };
  let lock = Promise.resolve();
  const db = {
    async query(sql, args) {
      assert.match(sql, /INSERT INTO attempts[\s\S]*SELECT[\s\S]*FROM quizzes WHERE quizid = \$1 AND userid = \$2/);
      return { rows: args[0] === 3 && args[1] === state.quizOwner ? [{ attemptid: 91 }] : [] };
    },
    async getClient() {
      let unlock;
      let snapshot;
      let inserts = 0;
      return {
        async query(sql, args = []) {
          state.calls.push({ sql, args });
          if (sql === "BEGIN") return { rows: [] };
          if (sql.includes("FOR UPDATE OF a")) {
            assert.match(sql, /a.attemptid = \$1 AND a.quizid = \$2/);
            assert.match(sql, /a.userid = \$3 AND q.userid = \$3/);
            const previous = lock;
            lock = new Promise(resolve => { unlock = resolve; });
            await previous;
            snapshot = structuredClone({ attempt: state.attempt, answers: state.answers });
            const a = state.attempt;
            return { rows: args[0] === a.attemptid && args[1] === a.quizid && args[2] === a.userid && args[2] === state.quizOwner ? [{ ...a }] : [] };
          }
          if (sql.startsWith("SELECT 1 FROM answers")) return { rows: state.answers.length ? [{}] : [] };
          if (sql.includes("FROM questions")) return { rows: state.questions || questions };
          if (sql.includes("INSERT INTO answers")) {
            inserts++;
            if (inserts === state.failInsert) throw new Error("Simulated database failure");
            state.answers.push(args);
            return { rowCount: 1 };
          }
          if (sql.includes("UPDATE attempts")) {
            if (state.failUpdate) return { rowCount: 0 };
            const [score, maxscore, ispassed, attemptID, quizID, userID] = args;
            assert.equal(attemptID, 90); assert.equal(quizID, 3); assert.equal(userID, 7);
            Object.assign(state.attempt, { score, maxscore, ispassed, completedat: "completed" });
            return { rowCount: 1 };
          }
          if (sql === "ROLLBACK") {
            if (snapshot) Object.assign(state, snapshot);
            if (unlock) { unlock(); unlock = null; }
            return { rows: [] };
          }
          if (sql === "COMMIT") {
            if (state.failCommit) throw new Error("Simulated commit failure");
            if (unlock) { unlock(); unlock = null; }
            return { rows: [] };
          }
          throw new Error(`Unexpected query: ${sql}`);
        },
        release() { state.released++; },
      };
    },
  };
  return { state, db, service: createQuizAttemptService(db) };
}

test("attempt creation is constrained by quiz ownership", async () => {
  const { service } = fixture();
  assert.equal(await service.createAttempt(3, 7), 91);
  await assert.rejects(service.createAttempt(3, 8), status(404));
  await assert.rejects(service.createAttempt(4, 7), status(404));
});

test("success commits answers, full score and pass flag together", async () => {
  const { service, state } = fixture();
  const result = await service.saveAnswersAndScore(3, 90, 7, full);
  assert.equal(result.totalScore, 2);
  assert.equal(state.answers.length, 2);
  assert.equal(state.attempt.ispassed, true);
  assert.equal(state.released, 1);
  assert.equal(state.calls.at(-1).sql, "COMMIT");
});

test("foreign user, wrong quiz and wrong attempt cannot write or receive correct answers", async () => {
  for (const args of [[3, 90, 8], [4, 90, 7], [3, 91, 7]]) {
    const { service, state } = fixture();
    await assert.rejects(service.saveAnswersAndScore(...args, full), status(404));
    assert.equal(state.answers.length, 0);
    assert.equal(state.calls.some(c => c.sql.includes("FROM questions")), false);
    assert.equal(state.calls.at(-1).sql, "ROLLBACK");
    assert.equal(state.released, 1);
  }
  const { service } = fixture({ quizOwner: 8 });
  await assert.rejects(service.saveAnswersAndScore(3, 90, 7, full), status(404));
});

test("repeat submission is a 409 and cannot change an existing result", async () => {
  const { service, state } = fixture();
  await service.saveAnswersAndScore(3, 90, 7, full);
  await assert.rejects(service.saveAnswersAndScore(3, 90, 7, []), status(409));
  assert.equal(state.answers.length, 2);
  assert.equal(state.attempt.score, 2);
});

test("concurrent submissions serialize: one completion and one conflict", async () => {
  const { service, state } = fixture();
  const results = await Promise.allSettled([
    service.saveAnswersAndScore(3, 90, 7, full),
    service.saveAnswersAndScore(3, 90, 7, full),
  ]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.find(r => r.status === "rejected").reason.status, 409);
  assert.equal(state.answers.length, 2);
  assert.equal(state.released, 2);
});

test("validation errors never insert the earlier valid answers", async () => {
  const { service, state } = fixture();
  await assert.rejects(service.saveAnswersAndScore(3, 90, 7, [...full, { questionID: 50 }]), status(400));
  assert.equal(state.calls.some(c => c.sql.includes("INSERT INTO answers")), false);
  assert.equal(state.attempt.completedat, null);
});

test("legacy partially saved attempt is preserved and rejected", async () => {
  const { service, state } = fixture({ answers: [[90, 1, "old answer"]] });
  await assert.rejects(service.saveAnswersAndScore(3, 90, 7, full), status(409));
  assert.equal(state.answers.length, 1);
});

test("insert, update and commit failures roll back every new row and release the connection", async () => {
  for (const failure of [{ failInsert: 2 }, { failUpdate: true }, { failCommit: true }]) {
    const { service, state } = fixture(failure);
    await assert.rejects(service.saveAnswersAndScore(3, 90, 7, full));
    assert.equal(state.answers.length, 0);
    assert.equal(state.attempt.completedat, null);
    assert.equal(state.calls.at(-1).sql, "ROLLBACK");
    assert.equal(state.released, 1);
  }
});

function controllerWith(db) {
  const filename = path.join(__dirname, "../controllers/quizPlayController.js");
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    exports: module.exports, console,
    require: name => name === "../db" ? db : require(name),
  });
  return module.exports;
}
function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test("active controller preserves payload shape and maps conflicts to HTTP 409", async () => {
  const { db } = fixture();
  const controller = controllerWith(db);
  const req = { params: { quizID: "3", attemptID: "90" }, user: { userId: 7 }, body: { answers: full } };
  const res = response(); await controller.submitAnswers(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.maxScore, 2);
  assert.equal(res.body.details[0].correctAnswer, "A");
  const repeated = response(); await controller.submitAnswers(req, repeated);
  assert.equal(repeated.statusCode, 409);
});

test("history detail returns actual question text, selected answer and correct choice for the mobile screen", async () => {
  let queries = 0;
  const controller = controllerWith({ query: async () => ({ rows: ++queries === 1
    ? [{ completedat: "completed", score: 1, maxscore: 2 }]
    : [{ ...questions[0], answertext: "B", iscorrect: false, score: 0 }] }) });
  const res = response();
  await controller.getQuizAttemptDetail({ params: { quizID: "3", attemptID: "90" }, user: { userId: 7 } }, res);
  assert.equal(res.body.details[0].questionText, "Uno?");
  assert.equal(res.body.details[0].userAnswer, "B");
  assert.equal(res.body.details[0].correctAnswer, "A");
  assert.equal(res.body.details[0].correct, false);
});

test("legacy model delegates to the same protected create/save implementation", async () => {
  const { db, state } = fixture();
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../models/quizModel.js"), "utf8"), {
    exports: module.exports, console,
    require: name => name === "../db" ? db : require(name),
  });
  await assert.rejects(module.exports.createAttempt(3, 8), status(404));
  const result = await module.exports.saveAnswersAndScore(3, 90, 7, full.slice(0, 1));
  assert.equal(result.totalScore, 1);
  assert.equal(result.maxScore, 2);
  assert.equal(state.answers.length, 2);
  await assert.rejects(module.exports.saveAnswersAndScore(3, 90, 7, full), status(409));
});
