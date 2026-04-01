const SESSION_COOKIE = "soccer_points_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;
const DEFAULT_ADMIN_USERNAME = "admin1234";
const DEFAULT_ADMIN_PASSWORD = "gamer@00";
const PASSWORD_ITERATIONS = 100000;

let setupPromise = null;

export default {
  async fetch(request, env) {
    try {
      await ensureSetup(env);
      return await routeRequest(request, env);
    } catch (error) {
      return json(
        {
          success: false,
          message: error.message || "Server error",
        },
        error.status || 500
      );
    }
  },
};

async function routeRequest(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;

  if (pathname === "/health") {
    return json({ success: true, database: "d1" });
  }

  if (pathname === "/auth/register" && request.method === "POST") {
    return handleBrowserRegister(request, env);
  }

  if (pathname === "/auth/login" && request.method === "POST") {
    return handleBrowserLogin(request, env);
  }

  if (pathname === "/logout" && request.method === "POST") {
    return clearSessionAndRedirect();
  }

  if (pathname === "/register" && request.method === "POST") {
    const body = await request.json();
    const result = await registerUser(env, body.username, body.password);
    return json({ success: true, user: result.user });
  }

  if (pathname === "/login" && request.method === "POST") {
    const body = await request.json();
    const result = await loginUser(env, body.username, body.password);
    return json({ success: true, user: result.user });
  }

  if (pathname === "/me" && request.method === "GET") {
    const user = await requireUser(request, env);
    return json({ success: true, user });
  }

  if (pathname === "/users" && request.method === "GET") {
    const user = await requireAdmin(request, env);
    void user;
    const users = await dbAll(
      env,
      "SELECT id, username, role, points FROM users ORDER BY role DESC, username ASC"
    );
    return json({
      success: true,
      users: users.map(normalizeUser),
    });
  }

  if (pathname === "/leaderboard" && request.method === "GET") {
    await requireUser(request, env);
    const leaderboard = await dbAll(
      env,
      `SELECT username, points
       FROM users
       WHERE role = ?
       ORDER BY points DESC, username ASC
       LIMIT 10`,
      ["player"]
    );
    return json({
      success: true,
      leaderboard: leaderboard.map((entry) => ({
        username: entry.username,
        points: Number(entry.points),
      })),
    });
  }

  if (pathname === "/points" && request.method === "POST") {
    await requireAdmin(request, env);
    const body = await request.json();
    const username = String(body.username || "").trim();
    const amount = Number(body.amount);

    if (!username || Number.isNaN(amount)) {
      return json(
        { success: false, message: "Username and amount are required" },
        400
      );
    }

    const target = await dbGet(
      env,
      "SELECT id, username, role, points FROM users WHERE username = ?",
      [username]
    );

    if (!target) {
      return json({ success: false, message: "User not found" }, 404);
    }

    const nextPoints = Number(target.points) + amount;
    await dbRun(env, "UPDATE users SET points = ? WHERE id = ?", [
      nextPoints,
      target.id,
    ]);

    return json({
      success: true,
      message: `${amount >= 0 ? "Added" : "Removed"} ${Math.abs(amount)} points`,
      user: {
        ...normalizeUser(target),
        points: nextPoints,
      },
    });
  }

  if (pathname === "/shop" && request.method === "GET") {
    await requireUser(request, env);
    const items = await dbAll(
      env,
      "SELECT id, name, cost, category FROM shop ORDER BY category ASC, cost ASC, name ASC"
    );
    return json({
      success: true,
      items: items.map((item) => ({
        id: Number(item.id),
        name: item.name,
        cost: Number(item.cost),
        category: item.category,
      })),
    });
  }

  if (pathname === "/redeem" && request.method === "POST") {
    const user = await requireUser(request, env);
    const body = await request.json();
    const itemId = Number(body.itemId);

    if (Number.isNaN(itemId)) {
      return json({ success: false, message: "A valid item is required" }, 400);
    }

    const item = await dbGet(
      env,
      "SELECT id, name, cost FROM shop WHERE id = ?",
      [itemId]
    );

    if (!item) {
      return json({ success: false, message: "Item not found" }, 404);
    }

    const freshUser = await dbGet(
      env,
      "SELECT id, username, role, points FROM users WHERE id = ?",
      [user.id]
    );

    if (Number(freshUser.points) < Number(item.cost)) {
      return json(
        { success: false, message: "Not enough points for this item" },
        400
      );
    }

    const updatedPoints = Number(freshUser.points) - Number(item.cost);
    await dbRun(env, "UPDATE users SET points = ? WHERE id = ?", [
      updatedPoints,
      freshUser.id,
    ]);
    await dbRun(
      env,
      "INSERT INTO redemptions (username, item, cost) VALUES (?, ?, ?)",
      [freshUser.username, item.name, item.cost]
    );

    return json({
      success: true,
      message: `Redeemed ${item.name}`,
      user: {
        ...normalizeUser(freshUser),
        points: updatedPoints,
      },
    });
  }

  if (pathname === "/redemptions" && request.method === "GET") {
    await requireAdmin(request, env);
    const logs = await dbAll(
      env,
      "SELECT id, username, item, cost, created_at FROM redemptions ORDER BY id DESC"
    );
    return json({
      success: true,
      logs: logs.map((log) => ({
        id: Number(log.id),
        username: log.username,
        item: log.item,
        cost: Number(log.cost),
        created_at: log.created_at,
      })),
    });
  }

  if (request.method === "GET" || request.method === "HEAD") {
    return env.ASSETS.fetch(request);
  }

  return json({ success: false, message: "Not found" }, 404);
}

async function ensureSetup(env) {
  if (!setupPromise) {
    setupPromise = setupDatabase(env).catch((error) => {
      setupPromise = null;
      throw error;
    });
  }

  return setupPromise;
}

async function setupDatabase(env) {
  await dbRun(
    env,
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'player',
      points INTEGER NOT NULL DEFAULT 0
    )`
  );

  await dbRun(
    env,
    `CREATE TABLE IF NOT EXISTS shop (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      cost INTEGER NOT NULL,
      category TEXT NOT NULL DEFAULT 'reward'
    )`
  );

  await dbRun(
    env,
    `CREATE TABLE IF NOT EXISTS redemptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      item TEXT NOT NULL,
      cost INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  );

  const adminUsername = env.ADMIN_USERNAME || DEFAULT_ADMIN_USERNAME;
  const adminPassword = env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
  const existingAdmin = await dbGet(
    env,
    "SELECT id FROM users WHERE username = ?",
    [adminUsername]
  );
  const adminHash = await hashPassword(adminPassword);

  if (existingAdmin) {
    await dbRun(
      env,
      "UPDATE users SET password = ?, role = 'admin' WHERE id = ?",
      [adminHash, existingAdmin.id]
    );
  } else {
    await dbRun(
      env,
      "INSERT INTO users (username, password, role, points) VALUES (?, ?, 'admin', 0)",
      [adminUsername, adminHash]
    );
  }

  const shopCount = await dbGet(env, "SELECT COUNT(*) AS count FROM shop");
  if (Number(shopCount.count) === 0) {
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
      await dbRun(
        env,
        "INSERT INTO shop (name, cost, category) VALUES (?, ?, ?)",
        [name, cost, category]
      );
    }
  }
}

async function handleBrowserRegister(request, env) {
  const form = await request.formData();
  const baseUrl = new URL(request.url).origin;

  try {
    const result = await registerUser(
      env,
      form.get("username"),
      form.get("password")
    );
    return redirectWithSession(`${baseUrl}/home.html`, result.user, env);
  } catch (error) {
    return redirectResponse(
      `${baseUrl}/index.html?error=${encodeURIComponent(error.message)}`
    );
  }
}

async function handleBrowserLogin(request, env) {
  const form = await request.formData();
  const baseUrl = new URL(request.url).origin;

  try {
    const result = await loginUser(env, form.get("username"), form.get("password"));
    return redirectWithSession(`${baseUrl}/home.html`, result.user, env);
  } catch (error) {
    return redirectResponse(
      `${baseUrl}/index.html?error=${encodeURIComponent(error.message)}`
    );
  }
}

async function registerUser(env, username, password) {
  const cleanUsername = String(username || "").trim();
  const cleanPassword = String(password || "");

  if (!cleanUsername || !cleanPassword) {
    throw withStatus("Username and password are required", 400);
  }

  const existing = await dbGet(
    env,
    "SELECT id FROM users WHERE username = ?",
    [cleanUsername]
  );

  if (existing) {
    throw withStatus("Username already taken", 409);
  }

  const passwordHash = await hashPassword(cleanPassword);
  await dbRun(
    env,
    "INSERT INTO users (username, password, role, points) VALUES (?, ?, 'player', 0)",
    [cleanUsername, passwordHash]
  );

  const user = await dbGet(
    env,
    "SELECT id, username, role, points FROM users WHERE username = ?",
    [cleanUsername]
  );

  return { user: normalizeUser(user) };
}

async function loginUser(env, username, password) {
  const cleanUsername = String(username || "").trim();
  const cleanPassword = String(password || "");
  const user = await dbGet(env, "SELECT * FROM users WHERE username = ?", [
    cleanUsername,
  ]);

  if (!user) {
    throw withStatus("Invalid credentials", 401);
  }

  const valid = await verifyPassword(cleanPassword, user.password);
  if (!valid) {
    throw withStatus("Invalid credentials", 401);
  }

  return { user: normalizeUser(user) };
}

async function requireUser(request, env) {
  const session = await getSessionUser(request, env);
  if (!session) {
    throw withStatus("Missing session", 401);
  }

  return session;
}

async function requireAdmin(request, env) {
  const user = await requireUser(request, env);
  if (user.role !== "admin") {
    throw withStatus("Admin access required", 403);
  }

  return user;
}

async function getSessionUser(request, env) {
  const cookies = parseCookies(request.headers.get("Cookie") || "");
  const token = cookies[SESSION_COOKIE];

  if (!token) {
    return null;
  }

  const payload = await verifySignedToken(token, env.JWT_SECRET || "change-me");
  if (!payload || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  const user = await dbGet(
    env,
    "SELECT id, username, role, points FROM users WHERE id = ?",
    [payload.id]
  );

  return user ? normalizeUser(user) : null;
}

async function redirectWithSession(pathname, user, env) {
  const sessionToken = await createSignedToken(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
    },
    env.JWT_SECRET || "change-me"
  );

  const response = redirectResponse(pathname);
  response.headers.append("Set-Cookie", buildSessionCookie(sessionToken));
  return response;
}

function clearSessionAndRedirect() {
  const response = redirectResponse("/index.html");
  response.headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`
  );
  return response;
}

function redirectResponse(pathname) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: pathname,
    },
  });
}

function normalizeUser(user) {
  return {
    id: Number(user.id),
    username: user.username,
    role: user.role,
    points: Number(user.points),
  };
}

async function dbRun(env, sql, params = []) {
  return env.DB.prepare(sql).bind(...params).run();
}

async function dbGet(env, sql, params = []) {
  return env.DB.prepare(sql).bind(...params).first();
}

async function dbAll(env, sql, params = []) {
  const result = await env.DB.prepare(sql).bind(...params).all();
  return result.results || [];
}

async function hashPassword(password) {
  const salt = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));
  const bits = await derivePasswordBits(password, salt, PASSWORD_ITERATIONS);
  return `pbkdf2$${PASSWORD_ITERATIONS}$${salt}$${base64UrlEncode(bits)}`;
}

async function verifyPassword(password, storedHash) {
  const [scheme, iterationText, salt, hash] = String(storedHash || "").split("$");
  if (scheme !== "pbkdf2" || !iterationText || !salt || !hash) {
    return false;
  }

  const bits = await derivePasswordBits(password, salt, Number(iterationText));
  return base64UrlEncode(bits) === hash;
}

async function derivePasswordBits(password, salt, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  return new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: base64UrlDecode(salt),
        iterations,
        hash: "SHA-256",
      },
      keyMaterial,
      256
    )
  );
}

async function createSignedToken(payload, secret) {
  const data = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await signValue(data, secret);
  return `${data}.${signature}`;
}

async function verifySignedToken(token, secret) {
  const [data, signature] = String(token || "").split(".");
  if (!data || !signature) {
    return null;
  }

  const expected = await signValue(data, secret);
  if (signature !== expected) {
    return null;
  }

  try {
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(data)));
  } catch {
    return null;
  }
}

async function signValue(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value)
  );

  return base64UrlEncode(new Uint8Array(signature));
}

function buildSessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${SESSION_MAX_AGE}`;
}

function parseCookies(cookieHeader) {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const [name, ...valueParts] = part.split("=");
      cookies[name] = valueParts.join("=");
      return cookies;
    }, {});
}

function base64UrlEncode(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "===".slice((normalized.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function withStatus(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
