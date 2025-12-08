const db = require("../db");

/* ----------------------------------------------
   CREATE USER
---------------------------------------------- */
exports.createUser = async (username, passwordHash, fullName) => {
  await db.query(
    `
    INSERT INTO users (username, passwordhash, fullname, createdat)
    VALUES ($1, $2, $3, NOW())
    `,
    [username, passwordHash, fullName || null]
  );
};

/* ----------------------------------------------
   GET USER BY USERNAME
---------------------------------------------- */
exports.getUserByUsername = async (username) => {
  const result = await db.query(
    `
    SELECT userid, username, passwordhash, fullname
    FROM users
    WHERE username = $1
    LIMIT 1
    `,
    [username]
  );

  return result.rows[0] || null;
};

/* ----------------------------------------------
   GET USER BY ID
---------------------------------------------- */
exports.getUserById = async (userId) => {
  const result = await db.query(
    `
    SELECT userid, username, passwordhash, fullname
    FROM users
    WHERE userid = $1
    `,
    [userId]
  );

  return result.rows[0] || null;
};
