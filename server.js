// server.js
const express = require("express");
const path = require("path");
const Database = require("better-sqlite3"); // ✅ use better-sqlite3
const bcrypt = require("bcrypt");
const cors = require("cors");
const jwt = require("jsonwebtoken");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const SECRET = process.env.JWT_SECRET || "points-game-secret";

// Open database
const db = new Database(path.join(__dirname, "database.db"));

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(__dirname));

// Better-sqlite3 helpers
function run(sql, params = []) {
  const stmt = db.prepare(sql);
  return stmt.run(params);
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  return stmt.get(params);
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  return stmt.all(params);
}

function ensureColumn(tableName, columnName, definition) {
  const columns = all(`PRAGMA table_info(${tableName})`);
  const exists = columns.some((c) => c.name === columnName);
  if (!exists) {
    run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function seedDatabase() {
  // Create tables
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
  run("UPDATE redemptions SET created_at = COALESCE(created_at, CURRENT_TIMESTAMP)");

  // Remove test accounts
  run(`DELETE FROM users
       WHERE role = 'player' AND 
       (username = 'codextest1' OR username = 'player1' OR username LIKE 'freshuser_%'
        OR username LIKE 'rewriteuser_%' OR username LIKE 'signupcheck_%' OR username LIKE 'formsignup_%')`);

  // Admin account
  const adminHash = bcrypt.hashSync("gamer@00", 10);
  const targetAdmin = get("SELECT id FROM users WHERE username = ?", ["admin1234"]);
  const legacyAdmin = get("SELECT id FROM users WHERE username = ?", ["admin"]);

  if (targetAdmin) {
    run("UPDATE users SET password = ?, role = 'admin' WHERE id = ?", [adminHash, targetAdmin.id]);
  } else if (legacyAdmin) {
    run("UPDATE users SET username = ?, password = ?, role = 'admin' WHERE id = ?", ["admin1234", adminHash, legacyAdmin.id]);
  } else {
    run("INSERT INTO users (username, password, role, points) VALUES (?, ?, 'admin', 0)", ["admin1234", adminHash]);
  }

  // Shop items
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
    run("INSERT INTO shop (name, cost, category) VALUES (?, ?, ?)", [name, cost, category]);
  }
}

// JWT helpers
function createToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET, { expiresIn: "7d" });
}

function sendBrowserAuthSuccess(res, token) {
  res.type("html").send(`<!doctype html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Signing In</title></head>
<body>
<script>
  localStorage.setItem("token", ${JSON.stringify(token)});
  window.location.href = "/home.html";
</script>
</body>
</html>`);
}

function redirectToIndexWithError(res, message) {
  res.redirect(`/index.html?error=${encodeURIComponent(message)}`);
}

// Auth functions
function registerUser(username, password) {
  const cleanUsername = String(username || "").trim();
  const cleanPassword = String(password || "");
  if (!cleanUsername || !cleanPassword) throw new Error("Username and password are required");

  const existing = get("SELECT id FROM users WHERE username = ?", [cleanUsername]);
  if (existing) throw new Error("Username already taken");

  const hash = bcrypt.hashSync(cleanPassword, 10);
  const result = run("INSERT INTO users (username, password, role, points) VALUES (?, ?, 'player', 0)", [cleanUsername, hash]);
  const user = get("SELECT id, username, role, points FROM users WHERE id = ?", [result.lastInsertRowid]);

  return { token: createToken(user), user };
}

function loginUser(username, password) {
  const cleanUsername = String(username || "").trim();
  const cleanPassword = String(password || "");
  const user = get("SELECT * FROM users WHERE username = ?", [cleanUsername]);
  if (!user) throw new Error("Invalid credentials");

  const match = bcrypt.compareSync(cleanPassword, user.password);
  if (!match) throw new Error("Invalid credentials");

  return { token: createToken(user), user: { id: user.id, username: user.username, role: user.role, points: user.points } };
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  if (!token) return res.status(401).json({ success: false, message: "Missing token" });

  try {
    const decoded = jwt.verify(token, SECRET);
    const user = get("SELECT id, username, role, points FROM users WHERE id = ?", [decoded.id]);
    if (!user) return res.status(401).json({ success: false, message: "User not found" });
    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({ success: false, message: "Invalid token" });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ success: false, message: "Admin access required" });
  next();
}

// Routes
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/home.html", (req, res) => res.sendFile(path.join(__dirname, "home.html")));
app.get("/shop.html", (req, res) => res.sendFile(path.join(__dirname, "shop.html")));
app.get("/health", (req, res) => res.json({ success: true }));

app.post("/register", (req, res) => {
  try {
    const { token, user } = registerUser(req.body.username, req.body.password);
    res.json({ success: true, token, user });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

app.post("/login", (req, res) => {
  try {
    const { token, user } = loginUser(req.body.username, req.body.password);
    res.json({ success: true, token, user });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

app.post("/auth/register", (req, res) => {
  try {
    const { token } = registerUser(req.body.username, req.body.password);
    sendBrowserAuthSuccess(res, token);
  } catch (err) {
    redirectToIndexWithError(res, err.message);
  }
});

app.post("/auth/login", (req, res) => {
  try {
    const { token } = loginUser(req.body.username, req.body.password);
    sendBrowserAuthSuccess(res, token);
  } catch (err) {
    redirectToIndexWithError(res, err.message);
  }
});

app.get("/me", auth, (req, res) => res.json({ success: true, user: req.user }));

app.get("/users", auth, adminOnly, (req, res) => {
  try {
    const users = all("SELECT id, username, role, points FROM users ORDER BY role DESC, username ASC");
    res.json({ success: true, users });
  } catch {
    res.status(500).json({ success: false, message: "Could not load users" });
  }
});

app.get("/leaderboard", auth, (req, res) => {
  try {
    const leaderboard = all("SELECT username, points FROM users WHERE role='player' ORDER BY points DESC, username ASC LIMIT 10");
    res.json({ success: true, leaderboard });
  } catch {
    res.status(500).json({ success: false, message: "Could not load leaderboard" });
  }
});

app.post("/points", auth, adminOnly, (req, res) => {
  const username = String(req.body.username || "").trim();
  const amount = Number(req.body.amount);
  if (!username || isNaN(amount)) return res.status(400).json({ success: false, message: "Username and amount are required" });

  const target = get("SELECT id, username, role, points FROM users WHERE username=?", [username]);
  if (!target) return res.status(404).json({ success: false, message: "User not found" });

  const nextPoints = target.points + amount;
  run("UPDATE users SET points=? WHERE id=?", [nextPoints, target.id]);
  res.json({ success: true, message: `${amount >= 0 ? "Added" : "Removed"} ${Math.abs(amount)} points`, user: { ...target, points: nextPoints } });
});

app.get("/shop", auth, (req, res) => {
  try {
    const items = all("SELECT id, name, cost, category FROM shop ORDER BY category ASC, cost ASC, name ASC");
    res.json({ success: true, items });
  } catch {
    res.status(500).json({ success: false, message: "Could not load shop" });
  }
});

app.post("/redeem", auth, (req, res) => {
  const itemId = Number(req.body.itemId);
  if (isNaN(itemId)) return res.status(400).json({ success: false, message: "A valid item is required" });

  const item = get("SELECT id, name, cost FROM shop WHERE id=?", [itemId]);
  if (!item) return res.status(404).json({ success: false, message: "Item not found" });

  const user = get("SELECT id, username, role, points FROM users WHERE id=?", [req.user.id]);
  if (user.points < item.cost) return res.status(400).json({ success: false, message: "Not enough points", user });

  const updatedPoints = user.points - item.cost;
  run("UPDATE users SET points=? WHERE id=?", [updatedPoints, user.id]);
  run("INSERT INTO redemptions (username, item, cost, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)", [user.username, item.name, item.cost]);

  res.json({ success: true, message: `Redeemed ${item.name}`, user: { ...user, points: updatedPoints } });
});

app.get("/redemptions", auth, adminOnly, (req, res) => {
  try {
    const logs = all("SELECT id, username, item, cost, created_at FROM redemptions ORDER BY id DESC");
    res.json({ success: true, logs });
  } catch {
    res.status(500).json({ success: false, message: "Could not load redemptions" });
  }
});

// Seed database and start server
seedDatabase();
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
