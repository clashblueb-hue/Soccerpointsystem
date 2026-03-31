const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const cors = require("cors");
const jwt = require("jsonwebtoken");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const SECRET = process.env.JWT_SECRET || "points-game-secret";
const DATABASE_PATH =
  process.env.DATABASE_PATH || path.join(__dirname, "database.db");
const DATABASE_URL = process.env.DATABASE_URL || "";
const IS_POSTGRES = Boolean(DATABASE_URL);

const sqliteDb = IS_POSTGRES ? null : new Database(DATABASE_PATH);
const postgresPool = IS_POSTGRES
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl:
        process.env.DATABASE_SSL === "false"
          ? false
          : { rejectUnauthorized: false },
    })
  : null;

if (sqliteDb) {
  sqliteDb.pragma("journal_mode = WAL");
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(__dirname));

function toPostgresSql(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

async function run(sql, params = []) {
  if (IS_POSTGRES) {
    const result = await postgresPool.query(toPostgresSql(sql), params);
    return {
      lastID: null,
      changes: result.rowCount || 0,
    };
  }

  const info = sqliteDb.prepare(sql).run(params);
  return {
    lastID: Number(info.lastInsertRowid),
    changes: info.changes,
  };
}

async function get(sql, params = []) {
  if (IS_POSTGRES) {
    const result = await postgresPool.query(toPostgresSql(sql), params);
    return result.rows[0];
  }

  return sqliteDb.prepare(sql).get(params);
}

async function all(sql, params = []) {
  if (IS_POSTGRES) {
    const result = await postgresPool.query(toPostgresSql(sql), params);
    return result.rows;
  }

  return sqliteDb.prepare(sql).all(params);
}

async function insertAndGetId(sql, params = []) {
  if (IS_POSTGRES) {
    const result = await postgresPool.query(
      `${toPostgresSql(sql)} RETURNING id`,
      params
    );
    return Number(result.rows[0].id);
  }

  const info = sqliteDb.prepare(sql).run(params);
  return Number(info.lastInsertRowid);
}

async function ensureColumn(tableName, columnName, definition) {
  if (IS_POSTGRES) {
    const column = await get(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = ?
         AND column_name = ?`,
      [tableName, columnName]
    );

    if (!column) {
      await run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }

    return;
  }

  const columns = await all(`PRAGMA table_info(${tableName})`);
  const exists = columns.some((column) => column.name === columnName);

  if (!exists) {
    await run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

async function seedDatabase() {
  if (IS_POSTGRES) {
    await run(`CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'player',
      points INTEGER NOT NULL DEFAULT 0
    )`);

    await run(`CREATE TABLE IF NOT EXISTS shop (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      cost INTEGER NOT NULL,
      category TEXT NOT NULL DEFAULT 'reward'
    )`);

    await run(`CREATE TABLE IF NOT EXISTS redemptions (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      item TEXT NOT NULL,
      cost INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  } else {
    await run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'player',
      points INTEGER NOT NULL DEFAULT 0
    )`);

    await run(`CREATE TABLE IF NOT EXISTS shop (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      cost INTEGER NOT NULL,
      category TEXT NOT NULL DEFAULT 'reward'
    )`);

    await run(`CREATE TABLE IF NOT EXISTS redemptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      item TEXT NOT NULL,
      cost INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  }

  await ensureColumn("users", "points", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("shop", "category", "TEXT NOT NULL DEFAULT 'reward'");
  await ensureColumn("redemptions", "cost", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn(
    "redemptions",
    "created_at",
    IS_POSTGRES ? "TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP" : "TEXT"
  );

  await run(
    "UPDATE redemptions SET created_at = COALESCE(created_at, CURRENT_TIMESTAMP)"
  );

  await run(
    `DELETE FROM users
     WHERE role = 'player'
       AND (
         username = 'codextest1'
         OR username = 'player1'
         OR username LIKE 'freshuser_%'
         OR username LIKE 'rewriteuser_%'
         OR username LIKE 'signupcheck_%'
         OR username LIKE 'formsignup_%'
       )`
  );

  const adminHash = await bcrypt.hash("gamer@00", 10);
  const targetAdmin = await get(
    "SELECT id FROM users WHERE username = ?",
    ["admin1234"]
  );
  const legacyAdmin = await get("SELECT id FROM users WHERE username = ?", [
    "admin",
  ]);

  if (targetAdmin) {
    await run(
      "UPDATE users SET password = ?, role = 'admin' WHERE id = ?",
      [adminHash, targetAdmin.id]
    );
  } else if (legacyAdmin) {
    await run(
      "UPDATE users SET username = ?, password = ?, role = 'admin' WHERE id = ?",
      ["admin1234", adminHash, legacyAdmin.id]
    );
  } else {
    await run(
      "INSERT INTO users (username, password, role, points) VALUES (?, ?, 'admin', 0)",
      ["admin1234", adminHash]
    );
  }

  await run("DELETE FROM shop");
  const items = [
    ["Plus 1 Goal", 100, "reward"],
    ["Free Kick", 50, "reward"],
    ["Gum", 15, "reward"],
    ["Welchs Juicefuls", 20, "snack"],
    ["Bear Paw", 50, "snack"],
    ["Hello Panda", 75, "snack"],
    ["Cheesestring", 50, "snack"],
  ];

  for (const [name, cost, category] of items) {
    await run("INSERT INTO shop (name, cost, category) VALUES (?, ?, ?)", [
      name,
      cost,
      category,
    ]);
  }
}

function createToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    SECRET,
    { expiresIn: "7d" }
  );
}

function sendBrowserAuthSuccess(res, token) {
  res.redirect(`/home.html#token=${encodeURIComponent(token)}`);
}

function redirectToIndexWithError(res, message) {
  res.redirect(`/index.html?error=${encodeURIComponent(message)}`);
}

async function registerUser(username, password) {
  const cleanUsername = String(username || "").trim();
  const cleanPassword = String(password || "");

  if (!cleanUsername || !cleanPassword) {
    const error = new Error("Username and password are required");
    error.status = 400;
    throw error;
  }

  const existing = await get("SELECT id FROM users WHERE username = ?", [
    cleanUsername,
  ]);

  if (existing) {
    const error = new Error("Username already taken");
    error.status = 409;
    throw error;
  }

  const hash = await bcrypt.hash(cleanPassword, 10);
  const userId = await insertAndGetId(
    "INSERT INTO users (username, password, role, points) VALUES (?, ?, 'player', 0)",
    [cleanUsername, hash]
  );
  const user = await get(
    "SELECT id, username, role, points FROM users WHERE id = ?",
    [userId]
  );

  return {
    token: createToken(user),
    user,
  };
}

async function loginUser(username, password) {
  const cleanUsername = String(username || "").trim();
  const cleanPassword = String(password || "");
  const user = await get("SELECT * FROM users WHERE username = ?", [cleanUsername]);

  if (!user) {
    const error = new Error("Invalid credentials");
    error.status = 401;
    throw error;
  }

  const match = await bcrypt.compare(cleanPassword, user.password);
  if (!match) {
    const error = new Error("Invalid credentials");
    error.status = 401;
    throw error;
  }

  return {
    token: createToken(user),
    user: {
      id: Number(user.id),
      username: user.username,
      role: user.role,
      points: Number(user.points),
    },
  };
}

async function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;

  if (!token) {
    res.status(401).json({ success: false, message: "Missing token" });
    return;
  }

  try {
    const decoded = jwt.verify(token, SECRET);
    const user = await get(
      "SELECT id, username, role, points FROM users WHERE id = ?",
      [decoded.id]
    );

    if (!user) {
      res.status(401).json({ success: false, message: "User not found" });
      return;
    }

    req.user = {
      id: Number(user.id),
      username: user.username,
      role: user.role,
      points: Number(user.points),
    };
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: "Invalid token" });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== "admin") {
    res.status(403).json({ success: false, message: "Admin access required" });
    return;
  }

  next();
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/home.html", (req, res) => {
  res.sendFile(path.join(__dirname, "home.html"));
});

app.get("/shop.html", (req, res) => {
  res.sendFile(path.join(__dirname, "shop.html"));
});

app.get("/health", (req, res) => {
  res.json({ success: true, database: IS_POSTGRES ? "postgres" : "sqlite" });
});

app.post("/register", async (req, res) => {
  try {
    const { token, user } = await registerUser(req.body.username, req.body.password);
    res.json({ success: true, token, user });
  } catch (error) {
    res
      .status(error.status || 500)
      .json({ success: false, message: error.message || "Could not register user" });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { token, user } = await loginUser(req.body.username, req.body.password);
    res.json({ success: true, token, user });
  } catch (error) {
    res
      .status(error.status || 500)
      .json({ success: false, message: error.message || "Could not log in" });
  }
});

app.post("/auth/register", async (req, res) => {
  try {
    const { token } = await registerUser(req.body.username, req.body.password);
    sendBrowserAuthSuccess(res, token);
  } catch (error) {
    redirectToIndexWithError(res, error.message || "Could not register user");
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { token } = await loginUser(req.body.username, req.body.password);
    sendBrowserAuthSuccess(res, token);
  } catch (error) {
    redirectToIndexWithError(res, error.message || "Could not log in");
  }
});

app.get("/me", auth, async (req, res) => {
  res.json({ success: true, user: req.user });
});

app.get("/users", auth, adminOnly, async (req, res) => {
  try {
    const users = await all(
      "SELECT id, username, role, points FROM users ORDER BY role DESC, username ASC"
    );
    res.json({
      success: true,
      users: users.map((user) => ({
        ...user,
        id: Number(user.id),
        points: Number(user.points),
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Could not load users" });
  }
});

app.get("/leaderboard", auth, async (req, res) => {
  try {
    const leaderboard = await all(
      `SELECT username, points
       FROM users
       WHERE role = 'player'
       ORDER BY points DESC, username ASC
       LIMIT 10`
    );
    res.json({
      success: true,
      leaderboard: leaderboard.map((entry) => ({
        ...entry,
        points: Number(entry.points),
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Could not load leaderboard" });
  }
});

app.post("/points", auth, adminOnly, async (req, res) => {
  const username = String(req.body.username || "").trim();
  const amount = Number(req.body.amount);

  if (!username || Number.isNaN(amount)) {
    res
      .status(400)
      .json({ success: false, message: "Username and amount are required" });
    return;
  }

  try {
    const target = await get(
      "SELECT id, username, role, points FROM users WHERE username = ?",
      [username]
    );

    if (!target) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    const nextPoints = Number(target.points) + amount;
    await run("UPDATE users SET points = ? WHERE id = ?", [
      nextPoints,
      target.id,
    ]);

    res.json({
      success: true,
      message: `${amount >= 0 ? "Added" : "Removed"} ${Math.abs(amount)} points`,
      user: {
        ...target,
        id: Number(target.id),
        points: nextPoints,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Could not update points" });
  }
});

app.get("/shop", auth, async (req, res) => {
  try {
    const items = await all(
      "SELECT id, name, cost, category FROM shop ORDER BY category ASC, cost ASC, name ASC"
    );
    res.json({
      success: true,
      items: items.map((item) => ({
        ...item,
        id: Number(item.id),
        cost: Number(item.cost),
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Could not load shop" });
  }
});

app.post("/redeem", auth, async (req, res) => {
  const itemId = Number(req.body.itemId);

  if (Number.isNaN(itemId)) {
    res.status(400).json({ success: false, message: "A valid item is required" });
    return;
  }

  try {
    const item = await get("SELECT id, name, cost FROM shop WHERE id = ?", [itemId]);
    if (!item) {
      res.status(404).json({ success: false, message: "Item not found" });
      return;
    }

    const user = await get(
      "SELECT id, username, role, points FROM users WHERE id = ?",
      [req.user.id]
    );

    if (Number(user.points) < Number(item.cost)) {
      res.status(400).json({
        success: false,
        message: "Not enough points for this item",
        user: {
          ...user,
          id: Number(user.id),
          points: Number(user.points),
        },
      });
      return;
    }

    const updatedPoints = Number(user.points) - Number(item.cost);
    await run("UPDATE users SET points = ? WHERE id = ?", [updatedPoints, user.id]);
    await run(
      "INSERT INTO redemptions (username, item, cost, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
      [user.username, item.name, item.cost]
    );

    res.json({
      success: true,
      message: `Redeemed ${item.name}`,
      user: {
        ...user,
        id: Number(user.id),
        points: updatedPoints,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Could not redeem item" });
  }
});

app.get("/redemptions", auth, adminOnly, async (req, res) => {
  try {
    const logs = await all(
      "SELECT id, username, item, cost, created_at FROM redemptions ORDER BY id DESC"
    );
    res.json({
      success: true,
      logs: logs.map((log) => ({
        ...log,
        id: Number(log.id),
        cost: Number(log.cost),
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Could not load redemptions" });
  }
});

seedDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(
        `Server running on http://localhost:${PORT} using ${
          IS_POSTGRES ? "Postgres" : "SQLite"
        }`
      );
    });
  })
  .catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
