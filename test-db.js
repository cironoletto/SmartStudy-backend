const db = require("./db");
console.log("DATABASE_URL:", process.env.DATABASE_URL);


(async () => {
  try {
    const result = await db.query("SELECT NOW()");
    console.log("✔️ DB OK:", result.rows[0]);
  } catch (err) {
    console.error("❌ Test DB fallito:", err);
  }
})();