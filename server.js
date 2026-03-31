const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcrypt");
const cors = require("cors");
const jwt = require("jsonwebtoken");

const app = express();
// Change PORT only if 3000 is busy on your computer.
const PORT = Number(process.env.PORT) || 3000;
// Change this secret before deploying to the internet so tokens stay private.
const SECRET = process.env.JWT_SECRET || "points-game-secret";
const db = new Database(path.join(__dirname, "database.db"));
db.pragma("journal_mode = WAL");

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(__dirname));

function run(sql, params = []) {
  const info = db.prepare(sql).run(params);
  return {
    lastID: Number(info.lastInsertRowid),
    changes: info.changes,
  };
}

function get(sql, params = []) {
  return db.prepare(sql).get(params);
}

function all(sql, params = []) {
  return db.prepare(sql).all(params);
}

function ensureColumn(tableName, columnName, definition) {
  const columns = all(`PRAGMA table_info(${tableName})`);
  const exists = columns.some((column) => column.name === columnName);

  if (!exists) {
    run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

async function seedDatabase() {
  // Step 1: Create the tables if this is the first time the app has run.
  run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'player',
    points INTEGER NOT NULL DEFAULT 0
  )`);

  run(`CREATE TABLE IF NOT EXISTS shop (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    cost INTEGER NOT NULL,
    category TEXT NOT NULL DEFAULT 'reward'
  )`);

  run(`CREATE TABLE IF NOT EXISTS redemptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    item TEXT NOT NULL,
    cost INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  ensureColumn("users", "points", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("shop", "category", "TEXT NOT NULL DEFAULT 'reward'");
  ensureColumn("redemptions", "cost", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("redemptions", "created_at", "TEXT");
  run(
    "UPDATE redemptions SET created_at = COALESCE(created_at, CURRENT_TIMESTAMP)"
  );

  // Remove the fake test accounts created during setup/debugging.
  run(
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

  // Step 2: Force the main admin account to use the login you requested.
  // If you want to change the default admin later, edit these two values.
  const adminHash = await bcrypt.hash("gamer@00", 10);
  const targetAdmin = get(
    "SELECT id FROM users WHERE username = ?",
    ["admin1234"]
  );
  const legacyAdmin = get(
    "SELECT id FROM users WHERE username = ?",
    ["admin"]
  );

  if (targetAdmin) {
    run(
      "UPDATE users SET password = ?, role = 'admin' WHERE id = ?",
      [adminHash, targetAdmin.id]
    );
  } else if (legacyAdmin) {
    run(
      "UPDATE users SET username = ?, password = ?, role = 'admin' WHERE id = ?",
      ["admin1234", adminHash, legacyAdmin.id]
    );
  } else {
    run(
      "INSERT INTO users (username, password, role, points) VALUES (?, ?, 'admin', 0)",
      ["admin1234", adminHash]
    );
  }

  // Replace the default shop with the rewards you asked for.
  run("DELETE FROM shop");
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
    run("INSERT INTO shop (name, cost, category) VALUES (?, ?, ?)", [
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

  const existing = get("SELECT id FROM users WHERE username = ?", [
    cleanUsername,
  ]);

  if (existing) {
    const error = new Error("Username already taken");
    error.status = 409;
    throw error;
  }

  const hash = await bcrypt.hash(cleanPassword, 10);
  const result = run(
    "INSERT INTO users (username, password, role, points) VALUES (?, ?, 'player', 0)",
    [cleanUsername, hash]
  );
  const user = get(
    "SELECT id, username, role, points FROM users WHERE id = ?",
    [result.lastID]
  );

  return {
    token: createToken(user),
    user,
  };
}

async function loginUser(username, password) {
  const cleanUsername = String(username || "").trim();
  const cleanPassword = String(password || "");
  const user = get("SELECT * FROM users WHERE username = ?", [cleanUsername]);

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
      id: user.id,
      username: user.username,
      role: user.role,
      points: user.points,
    },
  };
}

async function auth(req, res, next) {
  // Every protected route uses this to make sure the user is logged in.
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;

  if (!token) {
    res.status(401).json({ success: false, message: "Missing token" });
    return;
  }

  try {
    const decoded = jwt.verify(token, SECRET);
    const user = get(
      "SELECT id, username, role, points FROM users WHERE id = ?",
      [decoded.id]
    );

    if (!user) {
      res.status(401).json({ success: false, message: "User not found" });
      return;
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: "Invalid token" });
  }
}

function adminOnly(req, res, next) {
  // Use this on routes that only admins should be allowed to use.
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
  res.json({ success: true });
});

// Players create their own accounts here. New accounts always start at 0 points.
app.post("/register", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    const { token, user } = await registerUser(username, password);

    res.json({
      success: true,
      token,
      user,
    });
  } catch (error) {
    res
      .status(error.status || 500)
      .json({ success: false, message: error.message || "Could not register user" });
  }
});

app.post("/login", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    const { token, user } = await loginUser(username, password);

    res.json({
      success: true,
      token,
      user,
    });
  } catch (error) {
    res
      .status(error.status || 500)
      .json({ success: false, message: error.message || "Could not log in" });
  }
});

// These form routes make the first page work even if frontend fetch code fails.
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

// Admin dashboard uses this to load every user and their current points.
app.get("/users", auth, adminOnly, async (req, res) => {
  try {
    const users = all(
      "SELECT id, username, role, points FROM users ORDER BY role DESC, username ASC"
    );
    res.json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, message: "Could not load users" });
  }
});

app.get("/leaderboard", auth, async (req, res) => {
  try {
    const leaderboard = all(
      `SELECT username, points
       FROM users
       WHERE role = 'player'
       ORDER BY points DESC, username ASC
       LIMIT 10`
    );
    res.json({ success: true, leaderboard });
  } catch (error) {
    res.status(500).json({ success: false, message: "Could not load leaderboard" });
  }
});

// Admin uses this route to add or remove points from a player account.
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
    const target = get(
      "SELECT id, username, role, points FROM users WHERE username = ?",
      [username]
    );

    if (!target) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    const nextPoints = target.points + amount;
    run("UPDATE users SET points = ? WHERE id = ?", [nextPoints, target.id]);

    res.json({
      success: true,
      message: `${amount >= 0 ? "Added" : "Removed"} ${Math.abs(amount)} points`,
      user: { ...target, points: nextPoints },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Could not update points" });
  }
});

// The separate shop page reads the available rewards from this route.
app.get("/shop", auth, async (req, res) => {
  try {
    const items = all(
      "SELECT id, name, cost, category FROM shop ORDER BY category ASC, cost ASC, name ASC"
    );
    res.json({ success: true, items });
  } catch (error) {
    res.status(500).json({ success: false, message: "Could not load shop" });
  }
});

// Players spend points here when they click Redeem in the shop page.
app.post("/redeem", auth, async (req, res) => {
  const itemId = Number(req.body.itemId);

  if (Number.isNaN(itemId)) {
    res.status(400).json({ success: false, message: "A valid item is required" });
    return;
  }

  try {
    const item = get("SELECT id, name, cost FROM shop WHERE id = ?", [itemId]);
    if (!item) {
      res.status(404).json({ success: false, message: "Item not found" });
      return;
    }

    const user = get(
      "SELECT id, username, role, points FROM users WHERE id = ?",
      [req.user.id]
    );

    if (user.points < item.cost) {
      res.status(400).json({
        success: false,
        message: "Not enough points for this item",
        user,
      });
      return;
    }

    const updatedPoints = user.points - item.cost;
    run("UPDATE users SET points = ? WHERE id = ?", [updatedPoints, user.id]);
    run(
      "INSERT INTO redemptions (username, item, cost, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
      [user.username, item.name, item.cost]
    );

    res.json({
      success: true,
      message: `Redeemed ${item.name}`,
      user: { ...user, points: updatedPoints },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Could not redeem item" });
  }
});

// Admin dashboard uses this log to show what players have redeemed.
app.get("/redemptions", auth, adminOnly, async (req, res) => {
  try {
    const logs = all(
      "SELECT id, username, item, cost, created_at FROM redemptions ORDER BY id DESC"
    );
    res.json({ success: true, logs });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Could not load redemptions" });
  }
});

seedDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
