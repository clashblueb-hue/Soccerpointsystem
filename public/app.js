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

function applyTheme(theme) {
  document.body.dataset.theme = theme || "default";
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
  const shopAdminList = document.getElementById("shopAdminList");
  const logList = document.getElementById("logList");
  const shopButton = document.getElementById("shopButton");
  const wheelButton = document.getElementById("wheelButton");
  const settingsButton = document.getElementById("settingsButton");
  const logoutButton = document.getElementById("logoutButton");
  const profileLetterBadge = document.getElementById("profileLetterBadge");
  const newShopName = document.getElementById("newShopName");
  const newShopCost = document.getElementById("newShopCost");
  const newShopCategory = document.getElementById("newShopCategory");
  const createShopItemButton = document.getElementById("createShopItemButton");

  let user = null;

  function renderUserShell() {
    heroTitle.textContent = `Welcome, ${user.username}`;
    welcomeTitle.textContent = `${user.username}'s Home`;
    roleValue.textContent =
      user.role.charAt(0).toUpperCase() + user.role.slice(1);
    pointsValue.textContent = user.points;
    applyTheme(user.theme);

    if (user.role === "admin") {
      heroText.textContent =
        "You can manage player balances and review redemptions here.";
      nextStepText.textContent =
        "Use the player cards below to add or remove points, or delete an extra player account.";
      playerHome.classList.add("hidden");
      adminHome.classList.remove("hidden");
      wheelButton.classList.add("hidden");
      settingsButton.classList.add("hidden");
      return;
    }

    heroText.textContent =
      "Open the shop when you want to spend the points you have earned.";
    nextStepText.textContent =
      "Use the Open Shop button or Daily Wheel button to try to grow your points.";
    playerHome.classList.remove("hidden");
    adminHome.classList.add("hidden");
    wheelButton.classList.remove("hidden");
    settingsButton.classList.remove("hidden");
    profileLetterBadge.textContent = user.profileLetter || "P";
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

  async function saveShopItem(itemId) {
    clearMessage(message);
    const costInput = document.getElementById(`shop-cost-${itemId}`);
    const nameInput = document.getElementById(`shop-name-${itemId}`);
    const categoryInput = document.getElementById(`shop-category-${itemId}`);
    const outOfStockInput = document.getElementById(`shop-stock-${itemId}`);
    const stockNoteInput = document.getElementById(`shop-note-${itemId}`);

    try {
      const data = await api("/api/shop/update", {
        method: "POST",
        body: JSON.stringify({
          itemId,
          name: nameInput.value,
          cost: Number(costInput.value),
          category: categoryInput.value,
          outOfStock: outOfStockInput.checked,
          stockNote: stockNoteInput.value,
        }),
      });

      setMessage(message, data.message);
      await loadPage();
    } catch (error) {
      setMessage(message, error.message, "error");
    }
  }

  window.saveShopItem = saveShopItem;

  async function createShopItem() {
    clearMessage(message);

    try {
      const data = await api("/api/shop/create", {
        method: "POST",
        body: JSON.stringify({
          name: newShopName.value,
          cost: Number(newShopCost.value),
          category: newShopCategory.value,
        }),
      });

      newShopName.value = "";
      newShopCost.value = "10";
      newShopCategory.value = "reward";
      setMessage(message, data.message);
      await loadPage();
    } catch (error) {
      setMessage(message, error.message, "error");
    }
  }

  window.createShopItem = createShopItem;

  async function deleteShopItem(itemId, itemName) {
    clearMessage(message);

    if (!window.confirm(`Delete the shop item "${itemName}"?`)) {
      return;
    }

    try {
      const data = await api("/api/shop/delete", {
        method: "POST",
        body: JSON.stringify({ itemId }),
      });

      setMessage(message, data.message);
      await loadPage();
    } catch (error) {
      setMessage(message, error.message, "error");
    }
  }

  window.deleteShopItem = deleteShopItem;

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

  function renderShopManager(items) {
    shopAdminList.innerHTML = items.length
      ? items
          .map(
            (item) => `
              <article class="user-card">
                <div class="row">
                  <div>
                    <h3>${escapeHtml(item.name)}</h3>
                    <div class="role">${escapeHtml(item.category)}</div>
                  </div>
                  <div class="points">${item.cost} pts</div>
                </div>
                <div class="shop-admin-grid">
                  <label class="stack">
                    <span class="muted">Item name</span>
                    <input id="shop-name-${item.id}" type="text" value="${escapeHtml(item.name)}" />
                  </label>
                  <label class="stack">
                    <span class="muted">Price</span>
                    <input id="shop-cost-${item.id}" type="number" min="0" step="1" value="${item.cost}" />
                  </label>
                  <label class="stack">
                    <span class="muted">Type</span>
                    <select id="shop-category-${item.id}">
                      <option value="reward" ${item.category === "reward" ? "selected" : ""}>Reward</option>
                      <option value="snack" ${item.category === "snack" ? "selected" : ""}>Snack</option>
                    </select>
                  </label>
                  <label class="stack checkbox-stack">
                    <span class="muted">Stock status</span>
                    <label class="toggle-row">
                      <input id="shop-stock-${item.id}" type="checkbox" ${item.outOfStock ? "checked" : ""} />
                      <span>Mark out of stock</span>
                    </label>
                  </label>
                  <label class="stack">
                    <span class="muted">Player message</span>
                    <input
                      id="shop-note-${item.id}"
                      type="text"
                      placeholder="Out of stock"
                      value="${escapeHtml(item.stockNote || "")}"
                    />
                  </label>
                </div>
                <div class="actions">
                  <button class="secondary" onclick="saveShopItem(${item.id})">Save Item</button>
                  <button
                    class="danger"
                    onclick="deleteShopItem(${item.id}, decodeURIComponent('${encodeURIComponent(item.name)}'))"
                  >
                    Delete Item
                  </button>
                </div>
              </article>
            `
          )
          .join("")
      : `<div class="empty">No shop items found yet.</div>`;
  }

  async function loadPage() {
    user = await getCurrentUser();
    renderUserShell();

    const leaderboardData = await api("/api/leaderboard", { method: "GET" });
    renderLeaderboard(leaderboardData.leaderboard);

    if (user.role === "admin") {
      const [usersData, logsData, shopData] = await Promise.all([
        api("/api/users", { method: "GET" }),
        api("/api/redemptions", { method: "GET" }),
        api("/api/shop", { method: "GET" }),
      ]);
      renderAdminLists(usersData.users, logsData.logs);
      renderShopManager(shopData.items);
    }
  }

  logoutButton.addEventListener("click", () => {
    logout();
  });

  createShopItemButton.addEventListener("click", () => {
    createShopItem();
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

  settingsButton.addEventListener("click", () => {
    if (user && user.role === "admin") {
      setMessage(message, "Admins do not use the player settings page.", "error");
      return;
    }

    window.location.href = "/settings.html";
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
  let refreshTimer = null;

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
              <p class="muted">${escapeHtml(item.stockNote || "Redeem this reward from your point balance.")}</p>
            </div>
            <div class="cost">${item.cost} pts</div>
          </div>
          ${
            item.outOfStock
              ? `<div class="stock-tag">Out of stock</div>`
              : ""
          }
          <button
            class="primary"
            onclick="redeem(${item.id})"
            ${user.points < item.cost || item.outOfStock ? "disabled" : ""}
          >
            ${item.outOfStock ? "Unavailable" : "Redeem"}
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
                        <div class="muted">${item.outOfStock ? escapeHtml(item.stockNote || "Out of stock") : `${item.cost} points`}</div>
                      </div>
                      <button
                        class="secondary"
                        onclick="redeem(${item.id})"
                        ${user.points < item.cost || item.outOfStock ? "disabled" : ""}
                      >
                        ${item.outOfStock ? "Unavailable" : "Redeem"}
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
    if (refreshTimer) {
      clearInterval(refreshTimer);
    }
    logout();
  });

  loadPage().catch((error) => {
    setMessage(message, error.message || "Please log in first.", "error");
    setTimeout(() => {
      window.location.href = "/index.html";
    }, 1000);
  });

  refreshTimer = setInterval(() => {
    loadPage().catch(() => {});
  }, 10000);
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

function initSettingsPage() {
  const message = document.getElementById("message");
  const themeSelect = document.getElementById("themeSelect");
  const profileLetterInput = document.getElementById("profileLetterInput");
  const saveSettingsButton = document.getElementById("saveSettingsButton");
  const settingsPreviewLetter = document.getElementById("settingsPreviewLetter");
  const settingsPreviewName = document.getElementById("settingsPreviewName");
  const logoutButton = document.getElementById("logoutButton");

  let user = null;

  function syncPreview() {
    const letter = String(profileLetterInput.value || user.profileLetter || user.username || "P")
      .trim()
      .charAt(0)
      .toUpperCase() || "P";
    settingsPreviewLetter.textContent = letter;
    applyTheme(themeSelect.value);
  }

  async function loadSettings() {
    user = await getCurrentUser();
    if (user.role === "admin") {
      window.location.href = "/home.html";
      return;
    }

    const data = await api("/api/settings", { method: "GET" });
    themeSelect.value = data.settings.theme;
    profileLetterInput.value = data.settings.profileLetter;
    settingsPreviewName.textContent = `${user.username}'s Preview`;
    syncPreview();
  }

  async function saveSettings() {
    clearMessage(message);

    try {
      const data = await api("/api/settings", {
        method: "POST",
        body: JSON.stringify({
          theme: themeSelect.value,
          profileLetter: profileLetterInput.value,
        }),
      });

      user = data.user;
      themeSelect.value = data.settings.theme;
      profileLetterInput.value = data.settings.profileLetter;
      syncPreview();
      setMessage(message, data.message);
    } catch (error) {
      setMessage(message, error.message, "error");
    }
  }

  themeSelect.addEventListener("change", syncPreview);
  profileLetterInput.addEventListener("input", () => {
    profileLetterInput.value = String(profileLetterInput.value || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 1);
    syncPreview();
  });
  saveSettingsButton.addEventListener("click", saveSettings);
  logoutButton.addEventListener("click", () => {
    logout();
  });

  loadSettings().catch((error) => {
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
    return;
  }

  if (page === "settings") {
    initSettingsPage();
  }
});

