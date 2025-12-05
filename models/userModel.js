const { getConnection, sql } = require("../db");

// ------------------- CREATE USER -------------------
exports.createUser = async (username, passwordHash, fullName) => {
  const pool = await getConnection(); // ✔️ ottieni connessione

  await pool.request()
    .input("Username", sql.NVarChar, username)
    .input("PasswordHash", sql.NVarChar, passwordHash)
    .input("FullName", sql.NVarChar, fullName || null)
    .query(`
      INSERT INTO Users (Username, PasswordHash, FullName, CreatedAt)
      VALUES (@Username, @PasswordHash, @FullName, GETDATE())
    `);
};

// ------------------- GET USER BY USERNAME -------------------
exports.getUserByUsername = async (username) => {
  const pool = await getConnection(); // ✔️ ottieni connessione

  const result = await pool.request()
    .input("Username", sql.NVarChar, username)
    .query(`
      SELECT TOP 1 UserID, Username, PasswordHash, FullName
      FROM Users
      WHERE Username = @Username
    `);

  return result.recordset[0] || null;
};

// ------------------- GET USER BY ID -------------------
exports.getUserById = async (userId) => {
  const pool = await getConnection(); // ✔️ ottieni connessione

  const result = await pool.request()
    .input("UserID", sql.Int, userId)
    .query(`
      SELECT UserID, Username, PasswordHash, FullName
      FROM Users
      WHERE UserID = @UserID
    `);

  return result.recordset[0] || null;
};
