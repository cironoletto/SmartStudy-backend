const db = require("../db");

exports.createUser = async (username, passwordHash, fullName, email) => {
  const result = await db.query(
    `INSERT INTO users (username, passwordhash, fullname, email, createdat)
     VALUES ($1, $2, $3, LOWER($4), NOW())
     RETURNING userid, username, fullname, email`,
    [username, passwordHash, fullName, email]
  );

  return result.rows[0];
};

exports.getUserByUsername = async (username) => {
  const result = await db.query(
    `SELECT userid, username, passwordhash, fullname, email, free_trial_ends_at
     FROM users
     WHERE LOWER(username) = LOWER($1)
     LIMIT 1`,
    [username]
  );

  return result.rows[0] || null;
};

exports.getUserByEmail = async (email) => {
  const result = await db.query(
    `SELECT userid, username, passwordhash, fullname, email, free_trial_ends_at
     FROM users
     WHERE LOWER(email) = LOWER($1)
     LIMIT 1`,
    [email]
  );

  return result.rows[0] || null;
};

exports.getUserById = async (userId) => {
  const result = await db.query(
    `SELECT userid, username, passwordhash, fullname, email, free_trial_ends_at
     FROM users
     WHERE userid = $1`,
    [userId]
  );

  return result.rows[0] || null;
};

exports.updateUserEmail = async (userId, email) => {
  const result = await db.query(
    `UPDATE users
     SET email = LOWER($2)
     WHERE userid = $1
     RETURNING userid, username, fullname, email`,
    [userId, email]
  );

  return result.rows[0] || null;
};

exports.updatePasswordHash = async (client, userId, passwordHash) => {
  await client.query(
    `UPDATE users
     SET passwordhash = $2
     WHERE userid = $1`,
    [userId, passwordHash]
  );
};
