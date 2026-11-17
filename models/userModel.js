const db = require("../db");

exports.createUser = async (username, passwordHash, fullName) => {
  const result = await db.query(
    `INSERT INTO users (username, passwordhash, fullname, createdat)
     VALUES ($1, $2, $3, NOW())
     RETURNING userid, username, fullname`,
    [username, passwordHash, fullName]
  );

  return result.rows[0];
};

exports.getUserByUsername = async (username) => {
  const result = await db.query(
    `SELECT userid, username, passwordhash, fullname
     FROM users
     WHERE LOWER(username) = LOWER($1)
     LIMIT 1`,
    [username]
  );

  return result.rows[0] || null;
};

exports.getUserById = async (userId) => {
  const result = await db.query(
    `SELECT userid, username, passwordhash, fullname
     FROM users
     WHERE userid = $1`,
    [userId]
  );

  return result.rows[0] || null;
};
