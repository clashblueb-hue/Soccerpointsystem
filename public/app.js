// This file runs on every Cloudflare page.
// Keep the API calls same-origin so the Worker can manage login cookies for us.

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
  const headers = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
  };

  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers,
      credentials: "same-origin",
    });
  } catch (error) {
    throw new Error("The site could not reach the server.");
  }

  const raw = await response.text();
  let data = {};

  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch (error) {
      throw new Error(`The server sent an invalid response for ${path}.`);
    }
  }

  if (!response.ok) {
    throw new Error(data.message || raw || "Request failed");
  }

  return data;
}

async function getCurrentUser() {
  const data = await api("/api/me", { method: "GET" });
  return data.user;
}

async function logout() {
  await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
  window.location.href = "/index.html";
}

function initIndexPage() {
  const message = document.getElementById("message");
  const params = new URLSearchParams(window.location.search);
  const error = params.get("error");

  if (error) {
    setMessage(message, error, "error");
  }

  // If the user already has a valid cookie, skip the login page.
  getCurrentUser()
    .then(() => {
      window.location.href = "/home.html";
    })
    .catch(() => {});
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
  const wheelButton = document.getElementById("wheelButton");
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
        "Use the player cards below to add or remove points, or delete an extra player account.";
      playerHome.classList.add("hidden");
      adminHome.classList.remove("hidden");
      wheelButton.classList.add("hidden");
      return;
    }

    heroText.textContent =
      "Open the shop when you want to spend the points you have earned.";
    nextStepText.textContent =
      "Use the Open Shop button or Daily Wheel button to try to grow your points.";
    playerHome.classList.remove("hidden");
    adminHome.classList.add("hidden");
    wheelButton.classList.remove("hidden");
  }

  async function adjustPoints(username, amount) {
    clearMessage(message);

    try {
      const data = await api("/api/points", {
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

  async function deleteUser(username) {
    clearMessage(message);

    if (!window.confirm(`Delete the account "${username}"?`)) {
      return;
    }

    try {
      const data = await api("/api/users/delete", {
        method: "POST",
        body: JSON.stringify({ username }),
      });

      setMessage(message, data.message);
      await loadPage();
    } catch (error) {
      setMessage(message, error.message, "error");
    }
  }

  window.deleteUser = deleteUser;

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
                  ${
                    entry.role === "admin"
                      ? ""
                      : `<button class="danger" onclick="deleteUser(decodeURIComponent('${encodeURIComponent(entry.username)}'))">Delete</button>`
                  }
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
      : `<div class="empty">No players are on the leaderboard yet.</div>`;
  }

  async function loadPage() {
    user = await getCurrentUser();
    renderUserShell();

    const leaderboardData = await api("/api/leaderboard", { method: "GET" });
    renderLeaderboard(leaderboardData.leaderboard);

    if (user.role === "admin") {
      const [usersData, logsData] = await Promise.all([
        api("/api/users", { method: "GET" }),
        api("/api/redemptions", { method: "GET" }),
      ]);
      renderAdminLists(usersData.users, logsData.logs);
    }
  }

  logoutButton.addEventListener("click", () => {
    logout();
  });

  shopButton.addEventListener("click", () => {
    if (user && user.role === "admin") {
      setMessage(message, "Admins manage players from the home page.", "error");
      return;
    }

    window.location.href = "/shop.html";
  });

  wheelButton.addEventListener("click", () => {
    if (user && user.role === "admin") {
      setMessage(message, "Admins do not use the daily wheel.", "error");
      return;
    }

    window.location.href = "/wheel.html";
  });

  loadPage().catch((error) => {
    setMessage(message, error.message || "Please log in first.", "error");
    setTimeout(() => {
      window.location.href = "/index.html";
    }, 1000);
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
      const data = await api("/api/redeem", {
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
            <div class="cost">20+ pts</div>
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
    shopGrid.innerHTML =
      cards || `<div class="empty">No shop items are available yet.</div>`;
  }

  async function loadPage() {
    user = await getCurrentUser();
    if (user.role === "admin") {
      window.location.href = "/home.html";
      return;
    }

    renderHeader();
    const data = await api("/api/shop", { method: "GET" });
    renderShop(data.items);
  }

  logoutButton.addEventListener("click", () => {
    logout();
  });

  loadPage().catch((error) => {
    setMessage(message, error.message || "Please log in first.", "error");
    setTimeout(() => {
      window.location.href = "/index.html";
    }, 1000);
  });
}

function initWheelPage() {
  const message = document.getElementById("message");
  const wheelPlayerName = document.getElementById("wheelPlayerName");
  const wheelPlayerPoints = document.getElementById("wheelPlayerPoints");
  const ticketCount = document.getElementById("ticketCount");
  const wheelPointsValue = document.getElementById("wheelPointsValue");
  const wheelTicketsValue = document.getElementById("wheelTicketsValue");
  const claimStatusText = document.getElementById("claimStatusText");
  const betAmount = document.getElementById("betAmount");
  const claimTicketButton = document.getElementById("claimTicketButton");
  const spinButton = document.getElementById("spinButton");
  const wheelDisc = document.getElementById("wheelDisc");
  const wheelResultText = document.getElementById("wheelResultText");
  const logoutButton = document.getElementById("logoutButton");

  const rotationMap = [315, 45, 225, 135];
  let currentRotation = 0;
  let user = null;
  let wheelStatus = {
    tickets: 0,
    claimedToday: false,
  };

  function renderStatus() {
    wheelPlayerName.textContent = user.username;
    wheelPlayerPoints.textContent = `${user.points} points`;
    ticketCount.textContent = `${wheelStatus.tickets} ticket${wheelStatus.tickets === 1 ? "" : "s"}`;
    wheelPointsValue.textContent = user.points;
    wheelTicketsValue.textContent = wheelStatus.tickets;
    claimStatusText.textContent = wheelStatus.claimedToday
      ? "Today's ticket is already claimed."
      : "You can claim 1 ticket today.";
    claimTicketButton.disabled = wheelStatus.claimedToday;
    spinButton.disabled = wheelStatus.tickets < 1;
  }

  async function refreshWheelData() {
    user = await getCurrentUser();
    if (user.role === "admin") {
      window.location.href = "/home.html";
      return;
    }

    const statusData = await api("/api/wheel-status", { method: "GET" });
    wheelStatus = {
      tickets: statusData.tickets,
      claimedToday: statusData.claimedToday,
    };
    renderStatus();
  }

  async function claimTicket() {
    clearMessage(message);

    try {
      const data = await api("/api/wheel-claim", { method: "POST" });
      wheelStatus.tickets = data.tickets;
      wheelStatus.claimedToday = data.claimedToday;
      renderStatus();
      setMessage(message, data.message);
    } catch (error) {
      setMessage(message, error.message, "error");
    }
  }

  async function spinWheel() {
    clearMessage(message);
    const amount = Number(betAmount.value);

    try {
      const data = await api("/api/wheel-spin", {
        method: "POST",
        body: JSON.stringify({ betAmount: amount }),
      });

      user = data.user;
      wheelStatus.tickets = data.tickets;
      currentRotation += 1440 + rotationMap[data.result.index];
      wheelDisc.style.transform = `rotate(${currentRotation}deg)`;
      wheelResultText.textContent =
        `${data.result.label} on a ${data.result.betAmount} point bet. ` +
        `${data.result.pointChange >= 0 ? "Won" : "Lost"} ${Math.abs(data.result.pointChange)} points.`;
      renderStatus();
      setMessage(message, data.message);
    } catch (error) {
      setMessage(message, error.message, "error");
    }
  }

  claimTicketButton.addEventListener("click", () => {
    claimTicket();
  });

  spinButton.addEventListener("click", () => {
    spinWheel();
  });

  logoutButton.addEventListener("click", () => {
    logout();
  });

  refreshWheelData().catch((error) => {
    setMessage(message, error.message || "Please log in first.", "error");
    setTimeout(() => {
      window.location.href = "/index.html";
    }, 1000);
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
    return;
  }

  if (page === "wheel") {
    initWheelPage();
  }
});
