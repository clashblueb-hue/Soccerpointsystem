// If you open the HTML files directly, API calls still go to the local Node server.
const API_BASE =
  window.location.protocol === "file:"
    ? "http://localhost:3000"
    : window.location.origin;

function getPageUrl(pageName) {
  if (window.location.protocol === "file:") {
    return new URL(pageName, window.location.href).href;
  }

  return `/${pageName}`;
}

function goToPage(pageName) {
  window.location.href = getPageUrl(pageName);
}

function getToken() {
  return localStorage.getItem("token") || "";
}

function setToken(token) {
  localStorage.setItem("token", token);
}

function clearToken() {
  localStorage.removeItem("token");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[char];
  });
}

function setMessage(element, text, type = "success") {
  if (!element) {
    return;
  }

  element.textContent = text;
  element.className = `message ${type}`;
}

function clearMessage(element) {
  if (!element) {
    return;
  }

  element.textContent = "";
  element.className = "message";
}

async function api(path, options = {}) {
  const token = getToken();
  const headers = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
  };

  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch (error) {
    throw new Error(
      window.location.protocol === "file:"
        ? "Cannot reach the app server. Start it with `node server.js`, then refresh this page."
        : "Cannot reach the server for this site right now."
    );
  }

  const raw = await response.text();
  let data = {};

  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch (error) {
      throw new Error("The server sent an invalid response.");
    }
  }

  if (!response.ok) {
    throw new Error(data.message || raw || "Request failed");
  }

  return data;
}

async function getCurrentUser() {
  const data = await api("/me", { method: "GET" });
  return data.user;
}

function initIndexPage() {
  const message = document.getElementById("message");
  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");
  const params = new URLSearchParams(window.location.search);
  const error = params.get("error");

  // Keep auth working both on the deployed site and when opening files locally.
  loginForm.action = `${API_BASE}/auth/login`;
  registerForm.action = `${API_BASE}/auth/register`;

  if (getToken()) {
    goToPage("home.html");
    return;
  }

  if (error) {
    setMessage(message, error, "error");
  }
}

function initHomePage() {
  const message = document.getElementById("message");
  const heroTitle = document.getElementById("heroTitle");
  const heroText = document.getElementById("heroText");
  const welcomeTitle = document.getElementById("welcomeTitle");
  const roleValue = document.getElementById("roleValue");
  const pointsValue = document.getElementById("pointsValue");
  const nextStepText = document.getElementById("nextStepText");
  const playerHome = document.getElementById("playerHome");
  const adminHome = document.getElementById("adminHome");
  const leaderboardList = document.getElementById("leaderboardList");
  const userList = document.getElementById("userList");
  const logList = document.getElementById("logList");
  const shopButton = document.getElementById("shopButton");
  const logoutButton = document.getElementById("logoutButton");

  let user = null;

  function renderUserShell() {
    heroTitle.textContent = `Welcome, ${user.username}`;
    welcomeTitle.textContent = `${user.username}'s Home`;
    roleValue.textContent =
      user.role.charAt(0).toUpperCase() + user.role.slice(1);
    pointsValue.textContent = user.points;

    if (user.role === "admin") {
      heroText.textContent =
        "You can manage player balances and review redemptions here.";
      nextStepText.textContent =
        "Use the player cards below to add or remove points.";
      playerHome.classList.add("hidden");
      adminHome.classList.remove("hidden");
      shopButton.classList.remove("hidden");
      return;
    }

    heroText.textContent =
      "You are on the app home page. Open the shop when you want to redeem rewards.";
    nextStepText.textContent =
      "Use the Open Shop button to spend your current points.";
    playerHome.classList.remove("hidden");
    adminHome.classList.add("hidden");
    shopButton.classList.remove("hidden");
  }

  async function adjustPoints(username, amount) {
    clearMessage(message);

    try {
      const data = await api("/points", {
        method: "POST",
        body: JSON.stringify({ username, amount }),
      });

      setMessage(message, data.message);
      await loadPage();
    } catch (error) {
      setMessage(message, error.message, "error");
    }
  }

  window.adjustPoints = adjustPoints;

  function renderAdminLists(users, logs) {
    userList.innerHTML = users.length
      ? users
          .map(
            (entry) => `
              <article class="user-card">
                <div class="row">
                  <div>
                    <h3>${escapeHtml(entry.username)}</h3>
                    <div class="role">${escapeHtml(entry.role)}</div>
                  </div>
                  <div class="points">${entry.points} pts</div>
                </div>
                <div class="actions">
                  <button class="secondary" onclick="adjustPoints(decodeURIComponent('${encodeURIComponent(entry.username)}'), 5)">+5</button>
                  <button class="secondary" onclick="adjustPoints(decodeURIComponent('${encodeURIComponent(entry.username)}'), 10)">+10</button>
                  <button class="secondary" onclick="adjustPoints(decodeURIComponent('${encodeURIComponent(entry.username)}'), 50)">+50</button>
                  <button class="danger" onclick="adjustPoints(decodeURIComponent('${encodeURIComponent(entry.username)}'), -5)">-5</button>
                  <button class="danger" onclick="adjustPoints(decodeURIComponent('${encodeURIComponent(entry.username)}'), -10)">-10</button>
                </div>
              </article>
            `
          )
          .join("")
      : `<div class="empty">No users found yet.</div>`;

    logList.innerHTML = logs.length
      ? logs
          .map(
            (log) => `
              <article class="log-card">
                <div class="row">
                  <div>
                    <h3>${escapeHtml(log.username)}</h3>
                    <p class="muted">${escapeHtml(log.item)}</p>
                  </div>
                  <div class="points">-${log.cost} pts</div>
                </div>
                <div class="muted">${new Date(log.created_at).toLocaleString()}</div>
              </article>
            `
          )
          .join("")
      : `<div class="empty">No one has redeemed anything yet.</div>`;
  }

  function renderLeaderboard(entries) {
    leaderboardList.innerHTML = entries.length
      ? entries
          .map(
            (entry, index) => `
              <article class="user-card">
                <div class="leaderboard-entry">
                  <div class="actions">
                    <span class="rank-badge">${index + 1}</span>
                    <div>
                      <h3>${escapeHtml(entry.username)}</h3>
                      <p class="muted">Player ranking</p>
                    </div>
                  </div>
                  <div class="points">${entry.points} pts</div>
                </div>
              </article>
            `
          )
          .join("")
      : `<div class="empty">No players on the leaderboard yet.</div>`;
  }

  async function loadPage() {
    if (!getToken()) {
      goToPage("index.html");
      return;
    }

    user = await getCurrentUser();
    renderUserShell();

    const leaderboardData = await api("/leaderboard", { method: "GET" });
    renderLeaderboard(leaderboardData.leaderboard);

    if (user.role === "admin") {
      const [usersData, logsData] = await Promise.all([
        api("/users", { method: "GET" }),
        api("/redemptions", { method: "GET" }),
      ]);
      renderAdminLists(usersData.users, logsData.logs);
    }
  }

  logoutButton.addEventListener("click", () => {
    clearToken();
    goToPage("index.html");
  });

  shopButton.addEventListener("click", () => {
    goToPage("shop.html");
  });

  loadPage().catch((error) => {
    clearToken();
    setMessage(message, error.message, "error");
    setTimeout(() => goToPage("index.html"), 1200);
  });
}

function initShopPage() {
  const message = document.getElementById("message");
  const playerName = document.getElementById("playerName");
  const playerPoints = document.getElementById("playerPoints");
  const pointsValue = document.getElementById("pointsValue");
  const shopGrid = document.getElementById("shopGrid");
  const logoutButton = document.getElementById("logoutButton");

  let user = null;

  function renderHeader() {
    playerName.textContent = user.username;
    playerPoints.textContent = `${user.points} points`;
    pointsValue.textContent = user.points;
  }

  async function redeem(itemId) {
    clearMessage(message);

    try {
      const data = await api("/redeem", {
        method: "POST",
        body: JSON.stringify({ itemId }),
      });

      user = data.user;
      renderHeader();
      setMessage(message, data.message);
      await loadPage();
    } catch (error) {
      setMessage(message, error.message, "error");
    }
  }

  window.redeem = redeem;

  function renderShop(items) {
    const rewards = items.filter((item) => item.category !== "snack");
    const snacks = items.filter((item) => item.category === "snack");

    const rewardCards = rewards.map(
      (item) => `
        <article class="shop-card">
          <div class="shop-top">
            <div>
              <h3>${escapeHtml(item.name)}</h3>
              <p class="muted">Redeem this reward from your point balance.</p>
            </div>
            <div class="cost">${item.cost} pts</div>
          </div>
          <button
            class="primary"
            onclick="redeem(${item.id})"
            ${user.points < item.cost ? "disabled" : ""}
          >
            Redeem
          </button>
        </article>
      `
    );

    const snackCard = snacks.length
      ? `
        <article class="shop-card">
          <div class="shop-top">
            <div>
              <h3>Snacks</h3>
              <p class="muted">Open the menu and choose a snack reward.</p>
            </div>
            <div class="cost">15+ pts</div>
          </div>
          <details class="snack-details">
            <summary>Choose a snack</summary>
            <div class="snack-options">
              ${snacks
                .map(
                  (item) => `
                    <div class="snack-option">
                      <div>
                        <strong>${escapeHtml(item.name)}</strong>
                        <div class="muted">${item.cost} points</div>
                      </div>
                      <button
                        class="secondary"
                        onclick="redeem(${item.id})"
                        ${user.points < item.cost ? "disabled" : ""}
                      >
                        Redeem
                      </button>
                    </div>
                  `
                )
                .join("")}
            </div>
          </details>
        </article>
      `
      : "";

    const cards = [...rewardCards, snackCard].filter(Boolean).join("");
    shopGrid.innerHTML = cards || `<div class="empty">No shop items are available yet.</div>`;
  }

  async function loadPage() {
    if (!getToken()) {
      goToPage("index.html");
      return;
    }

    user = await getCurrentUser();
    if (user.role === "admin") {
      goToPage("home.html");
      return;
    }

    renderHeader();
    const data = await api("/shop", { method: "GET" });
    renderShop(data.items);
  }

  logoutButton.addEventListener("click", () => {
    clearToken();
    goToPage("index.html");
  });

  loadPage().catch((error) => {
    clearToken();
    setMessage(message, error.message, "error");
    setTimeout(() => goToPage("index.html"), 1200);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page;

  if (page === "index") {
    initIndexPage();
    return;
  }

  if (page === "home") {
    initHomePage();
    return;
  }

  if (page === "shop") {
    initShopPage();
  }
});
