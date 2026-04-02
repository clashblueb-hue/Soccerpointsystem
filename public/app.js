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

function formatSignedPoints(value) {
  const amount = Number(value) || 0;
  return `${amount >= 0 ? "+" : ""}${amount} pts`;
}

const PLAYER_STYLE_KEY = "player-style";

function applyTheme(theme) {
  document.body.dataset.theme = theme || "default";
}

function applyClickEffect(effect) {
  const nextEffect = effect || "none";
  document.body.dataset.clickEffect = nextEffect;

  const pendingEffect = sessionStorage.getItem("page-effect");
  if (pendingEffect && pendingEffect === nextEffect && nextEffect !== "none") {
    document.body.classList.remove("effect-transition-out");
    requestAnimationFrame(() => {
      document.body.classList.add("effect-transition-in");
      setTimeout(() => {
        document.body.classList.remove("effect-transition-in");
      }, nextEffect === "snap" ? 900 : 450);
    });
  }

  if (pendingEffect) {
    sessionStorage.removeItem("page-effect");
  }
}

function applyPlayerStyle(user) {
  applyTheme(user.theme);
  applyClickEffect(user.clickEffect);
  savePlayerStyle(user);
}

function savePlayerStyle(user) {
  try {
    localStorage.setItem(
      PLAYER_STYLE_KEY,
      JSON.stringify({
        theme: user.theme || "default",
        clickEffect: user.clickEffect || "none",
        profileLetter: user.profileLetter || "P",
      })
    );
  } catch {}
}

function getSavedPlayerStyle() {
  try {
    const raw = localStorage.getItem(PLAYER_STYLE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function primeSavedStyle() {
  const savedStyle = getSavedPlayerStyle();
  if (!savedStyle) {
    return;
  }

  applyTheme(savedStyle.theme);
  applyClickEffect(savedStyle.clickEffect);
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function triggerPageEffect(effect, mode = "navigate") {
  const nextEffect = effect || document.body.dataset.clickEffect || "none";
  if (nextEffect === "none") {
    return;
  }

  document.body.dataset.clickEffect = nextEffect;
  document.body.classList.remove("effect-transition-in");
  void document.body.offsetWidth;
  document.body.classList.add("effect-transition-out");
  await wait(nextEffect === "snap" ? 800 : 350);

  if (mode === "preview") {
    document.body.classList.remove("effect-transition-out");
    document.body.classList.add("effect-transition-in");
    await wait(nextEffect === "snap" ? 900 : 450);
    document.body.classList.remove("effect-transition-in");
  }
}

async function goTo(url) {
  const effect = document.body.dataset.clickEffect || "none";
  if (effect !== "none") {
    sessionStorage.setItem("page-effect", effect);
    await triggerPageEffect(effect, "navigate");
  }
  window.location.href = url;
}

function installInteractiveLinks() {
  document.addEventListener("click", (event) => {
    const link = event.target.closest("a.button-link");
    if (!link || event.defaultPrevented) {
      return;
    }

    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    const href = link.getAttribute("href");
    if (!href || href.startsWith("http") || href.startsWith("#")) {
      return;
    }

    event.preventDefault();
    goTo(href);
  });
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
  document.body.dataset.clickEffect = "none";
  try {
    localStorage.removeItem(PLAYER_STYLE_KEY);
  } catch {}
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
      goTo("/home.html");
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
  const wheelAdminList = document.getElementById("wheelAdminList");
  const logList = document.getElementById("logList");
  const adminTabs = Array.from(document.querySelectorAll(".admin-tab"));
  const adminPanels = Array.from(document.querySelectorAll(".admin-tab-panel"));
  const playerTabs = Array.from(document.querySelectorAll(".player-tab"));
  const playerPanels = Array.from(document.querySelectorAll(".player-tab-panel"));
  const shopButton = document.getElementById("shopButton");
  const wheelButton = document.getElementById("wheelButton");
  const settingsButton = document.getElementById("settingsButton");
  const logoutButton = document.getElementById("logoutButton");
  const profileLetterBadge = document.getElementById("profileLetterBadge");
  const newShopName = document.getElementById("newShopName");
  const newShopCost = document.getElementById("newShopCost");
  const newShopCategory = document.getElementById("newShopCategory");
  const createShopItemButton = document.getElementById("createShopItemButton");
  const saveWheelConfigButton = document.getElementById("saveWheelConfigButton");
  const requestRecipientSelect = document.getElementById("requestRecipientSelect");
  const requestAmountInput = document.getElementById("requestAmountInput");
  const sendRequestButton = document.getElementById("sendRequestButton");
  const incomingRequestsList = document.getElementById("incomingRequestsList");
  const outgoingRequestsList = document.getElementById("outgoingRequestsList");

  let user = null;
  let currentAdminTab = "players";
  let currentPlayerTab = "overview";
  let playerRefreshTimer = null;

  function activateAdminTab(tabName) {
    currentAdminTab = tabName;
    adminTabs.forEach((tab) => {
      const active = tab.dataset.adminTab === tabName;
      tab.classList.toggle("is-active", active);
      tab.classList.toggle("secondary", active);
      tab.classList.toggle("ghost", !active);
    });

    adminPanels.forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.adminPanel !== tabName);
    });
  }

  function activatePlayerTab(tabName) {
    currentPlayerTab = tabName;
    playerTabs.forEach((tab) => {
      const active = tab.dataset.playerTab === tabName;
      tab.classList.toggle("is-active", active);
      tab.classList.toggle("secondary", active);
      tab.classList.toggle("ghost", !active);
    });

    playerPanels.forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.playerPanel !== tabName);
    });
  }

  function renderUserShell() {
    heroTitle.textContent = `Welcome, ${user.username}`;
    welcomeTitle.textContent = `${user.username}'s Home`;
    roleValue.textContent =
      user.role.charAt(0).toUpperCase() + user.role.slice(1);
    pointsValue.textContent = user.points;
    applyPlayerStyle(user);

    if (user.role === "admin") {
      heroText.textContent =
        "You can manage players, the live shop, the slot machine, and purchases here.";
      nextStepText.textContent =
        "Use the tabs below to manage balances, tune the slot machine, and clear finished purchases.";
      playerHome.classList.add("hidden");
      adminHome.classList.remove("hidden");
      wheelButton.classList.add("hidden");
      settingsButton.classList.add("hidden");
      return;
    }

    heroText.textContent =
      "Use the weekly slot machine, the shop, and player requests to manage your points.";
    nextStepText.textContent =
      "Open the Weekly Slot button on Mondays, or use Point Requests if you want to ask another player for help.";
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

  async function adjustPointsFromMenu(username, direction) {
    const select = document.getElementById(
      `${direction}-points-${encodeURIComponent(username)}`
    );
    const rawValue = Number(select?.value || 0);
    if (!rawValue) {
      setMessage(message, "Choose a point amount first.", "error");
      return;
    }

    const signedAmount = direction === "remove" ? -rawValue : rawValue;
    await adjustPoints(username, signedAmount);
  }

  window.adjustPointsFromMenu = adjustPointsFromMenu;

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

  async function removeRedemption(redemptionId, isChecked) {
    if (!isChecked) {
      return;
    }

    clearMessage(message);

    try {
      const data = await api("/api/redemptions/delete", {
        method: "POST",
        body: JSON.stringify({ redemptionId }),
      });

      setMessage(message, data.message);
      await loadPage();
      activateAdminTab("purchases");
    } catch (error) {
      setMessage(message, error.message, "error");
      const checkbox = document.getElementById(`redeem-check-${redemptionId}`);
      if (checkbox) {
        checkbox.checked = false;
      }
    }
  }

  window.removeRedemption = removeRedemption;

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

  async function sendPointRequest() {
    clearMessage(message);

    try {
      const data = await api("/api/point-requests", {
        method: "POST",
        body: JSON.stringify({
          recipientUsername: requestRecipientSelect.value,
          amount: Number(requestAmountInput.value),
        }),
      });

      requestAmountInput.value = "10";
      setMessage(message, data.message);
      await loadPage();
      activatePlayerTab("requests");
    } catch (error) {
      setMessage(message, error.message, "error");
    }
  }

  async function respondToPointRequest(requestId, action) {
    clearMessage(message);

    try {
      const data = await api("/api/point-requests/respond", {
        method: "POST",
        body: JSON.stringify({ requestId, action }),
      });

      setMessage(message, data.message);
      await loadPage();
      activatePlayerTab("requests");
    } catch (error) {
      setMessage(message, error.message, "error");
    }
  }

  window.sendPointRequest = sendPointRequest;
  window.respondToPointRequest = respondToPointRequest;

  async function saveWheelConfig() {
    clearMessage(message);
    const prizes = Array.from({ length: 8 }, (_, index) => ({
      label: document.getElementById(`slot-label-${index}`)?.value || "",
      pointChange: Number(document.getElementById(`slot-change-${index}`)?.value || 0),
      weight: Number(document.getElementById(`slot-weight-${index}`)?.value || 0),
      active: document.getElementById(`slot-active-${index}`)?.checked || false,
    }));

    try {
      const data = await api("/api/wheel-config", {
        method: "POST",
        body: JSON.stringify({ prizes }),
      });

      setMessage(message, data.message);
      await loadPage();
      activateAdminTab("wheel");
    } catch (error) {
      setMessage(message, error.message, "error");
    }
  }

  window.saveWheelConfig = saveWheelConfig;

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
                  <div class="points-menu">
                    <select id="add-points-${encodeURIComponent(entry.username)}">
                      <option value="1">+1</option>
                      <option value="5">+5</option>
                      <option value="10" selected>+10</option>
                      <option value="50">+50</option>
                    </select>
                    <button
                      class="secondary"
                      onclick="adjustPointsFromMenu(decodeURIComponent('${encodeURIComponent(entry.username)}'), 'add')"
                    >
                      Add
                    </button>
                  </div>
                  <div class="points-menu">
                    <select id="remove-points-${encodeURIComponent(entry.username)}">
                      <option value="1">-1</option>
                      <option value="5" selected>-5</option>
                      <option value="10">-10</option>
                      <option value="50">-50</option>
                    </select>
                    <button
                      class="danger"
                      onclick="adjustPointsFromMenu(decodeURIComponent('${encodeURIComponent(entry.username)}'), 'remove')"
                    >
                      Remove
                    </button>
                  </div>
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
                <div class="muted">Bought: ${new Date(log.created_at).toLocaleString()}</div>
                <label class="toggle-row checklist-row">
                  <input id="redeem-check-${log.id}" type="checkbox" onchange="removeRedemption(${log.id}, this.checked)" />
                  <span>Handled and remove from the list</span>
                </label>
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

  function renderPointRequests(data) {
    const recipients = data.recipients || [];
    requestRecipientSelect.innerHTML = recipients.length
      ? recipients
          .map(
            (entry) => `
              <option value="${escapeHtml(entry.username)}">
                ${escapeHtml(entry.username)} (${entry.points} pts)
              </option>
            `
          )
          .join("")
      : `<option value="">No other players found</option>`;

    sendRequestButton.disabled = !data.canSendToday || recipients.length === 0;

    incomingRequestsList.innerHTML = data.incoming.length
      ? data.incoming
          .map(
            (entry) => `
              <article class="user-card">
                <div class="row">
                  <div>
                    <h3>${escapeHtml(entry.requesterName)}</h3>
                    <p class="muted">Asked for ${entry.amount} points</p>
                  </div>
                  <div class="points">${entry.amount} pts</div>
                </div>
                <div class="muted">Sent: ${new Date(entry.created_at).toLocaleString()}</div>
                <div class="actions">
                  <button class="secondary" onclick="respondToPointRequest(${entry.id}, 'approve')">Give Points</button>
                  <button class="danger" onclick="respondToPointRequest(${entry.id}, 'reject')">Reject</button>
                </div>
              </article>
            `
          )
          .join("")
      : `<div class="empty">No incoming requests right now.</div>`;

    outgoingRequestsList.innerHTML = data.outgoing.length
      ? data.outgoing
          .map(
            (entry) => `
              <article class="user-card">
                <div class="row">
                  <div>
                    <h3>${escapeHtml(entry.recipientName)}</h3>
                    <p class="muted">Requested ${entry.amount} points</p>
                  </div>
                  <div class="stock-tag request-status">${escapeHtml(entry.status)}</div>
                </div>
                <div class="muted">Requested: ${new Date(entry.created_at).toLocaleString()}</div>
                ${
                  entry.responded_at
                    ? `<div class="muted">Updated: ${new Date(entry.responded_at).toLocaleString()}</div>`
                    : ""
                }
              </article>
            `
          )
          .join("")
      : `<div class="empty">You have not made a request yet.</div>`;
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

  function renderWheelManager(prizes) {
    wheelAdminList.innerHTML = prizes
      .map(
        (prize) => `
          <article class="user-card slot-admin-card">
            <div class="row">
              <div>
                <h3>Prize ${prize.slotIndex + 1}</h3>
                <p class="muted">Live odds: ${prize.oddsPercent}%</p>
              </div>
              <div class="points">${formatSignedPoints(prize.pointChange)}</div>
            </div>
            <div class="slot-admin-grid">
              <label class="stack">
                <span class="muted">Prize name</span>
                <input id="slot-label-${prize.slotIndex}" type="text" value="${escapeHtml(prize.label)}" />
              </label>
              <label class="stack">
                <span class="muted">Point change</span>
                <input id="slot-change-${prize.slotIndex}" type="number" min="-500" max="500" step="1" value="${prize.pointChange}" />
              </label>
              <label class="stack">
                <span class="muted">Odds weight</span>
                <input id="slot-weight-${prize.slotIndex}" type="number" min="1" max="1000" step="1" value="${prize.weight}" />
              </label>
              <label class="stack checkbox-stack">
                <span class="muted">Use this prize</span>
                <label class="toggle-row">
                  <input id="slot-active-${prize.slotIndex}" type="checkbox" ${prize.active ? "checked" : ""} />
                  <span>Active</span>
                </label>
              </label>
            </div>
          </article>
        `
      )
      .join("");
  }

  async function loadPage() {
    user = await getCurrentUser();
    renderUserShell();

    const leaderboardData = await api("/api/leaderboard", { method: "GET" });
    renderLeaderboard(leaderboardData.leaderboard);

    if (user.role === "admin") {
      const [usersData, logsData, shopData, wheelData] = await Promise.all([
        api("/api/users", { method: "GET" }),
        api("/api/redemptions", { method: "GET" }),
        api("/api/shop", { method: "GET" }),
        api("/api/wheel-config", { method: "GET" }),
      ]);
      renderAdminLists(usersData.users, logsData.logs);
      renderShopManager(shopData.items);
      renderWheelManager(wheelData.prizes);
      activateAdminTab(currentAdminTab);
      return;
    }

    const requestData = await api("/api/point-requests", { method: "GET" });
    renderPointRequests(requestData);
    activatePlayerTab(currentPlayerTab);
  }

  logoutButton.addEventListener("click", () => {
    if (playerRefreshTimer) {
      clearInterval(playerRefreshTimer);
      playerRefreshTimer = null;
    }
    logout();
  });

  createShopItemButton.addEventListener("click", () => {
    createShopItem();
  });

  saveWheelConfigButton.addEventListener("click", () => {
    saveWheelConfig();
  });

  adminTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      activateAdminTab(tab.dataset.adminTab);
    });
  });

  playerTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      activatePlayerTab(tab.dataset.playerTab);
    });
  });

  sendRequestButton.addEventListener("click", () => {
    sendPointRequest();
  });

  shopButton.addEventListener("click", () => {
    if (user && user.role === "admin") {
      setMessage(message, "Admins manage players from the home page.", "error");
      return;
    }

    goTo("/shop.html");
  });

  wheelButton.addEventListener("click", () => {
    if (user && user.role === "admin") {
      setMessage(message, "Admins do not use the daily wheel.", "error");
      return;
    }

    goTo("/wheel.html");
  });

  settingsButton.addEventListener("click", () => {
    if (user && user.role === "admin") {
      setMessage(message, "Admins do not use the player settings page.", "error");
      return;
    }

    goTo("/settings.html");
  });

  loadPage().catch((error) => {
    setMessage(message, error.message || "Please log in first.", "error");
    setTimeout(() => {
      window.location.href = "/index.html";
    }, 1000);
  });

  playerRefreshTimer = setInterval(() => {
    if (!user || user.role === "admin") {
      return;
    }

    loadPage().catch(() => {});
  }, 15000);
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
      goTo("/home.html");
      return;
    }

    applyPlayerStyle(user);
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
  const claimTicketButton = document.getElementById("claimTicketButton");
  const spinButton = document.getElementById("spinButton");
  const wheelResultText = document.getElementById("wheelResultText");
  const logoutButton = document.getElementById("logoutButton");
  const slotPrizeGrid = document.getElementById("slotPrizeGrid");
  const reels = [0, 1, 2].map((index) => document.getElementById(`slotReel${index}`));

  let user = null;
  let spinning = false;
  let refreshTimer = null;
  let wheelStatus = {
    tickets: 0,
    canClaim: false,
    mondayOpen: false,
    prizes: [],
  };

  function renderStatus() {
    wheelPlayerName.textContent = user.username;
    wheelPlayerPoints.textContent = `${user.points} points`;
    ticketCount.textContent = `${wheelStatus.tickets} ticket${wheelStatus.tickets === 1 ? "" : "s"}`;
    wheelPointsValue.textContent = user.points;
    wheelTicketsValue.textContent = wheelStatus.tickets;
    claimStatusText.textContent = wheelStatus.mondayOpen
      ? wheelStatus.canClaim
        ? "Your Monday ticket is ready to claim."
        : "This Monday's ticket has already been claimed."
      : "Tickets unlock on Mondays only.";
    claimTicketButton.disabled = !wheelStatus.canClaim || spinning;
    spinButton.disabled = wheelStatus.tickets < 1 || wheelStatus.prizes.length === 0 || spinning;
  }

  function renderPrizeGrid() {
    slotPrizeGrid.innerHTML = wheelStatus.prizes.length
      ? wheelStatus.prizes
          .map(
            (prize) => `
              <article class="shop-card slot-prize-card">
                <div class="shop-top">
                  <div>
                    <h3>${escapeHtml(prize.label)}</h3>
                    <p class="muted">${prize.oddsPercent}% live odds</p>
                  </div>
                  <div class="cost">${formatSignedPoints(prize.pointChange)}</div>
                </div>
              </article>
            `
          )
          .join("")
      : `<div class="empty">The admin has not turned on any slot prizes yet.</div>`;
  }

  async function animateSlotMachine(resultLabel) {
    const labels = wheelStatus.prizes.length
      ? wheelStatus.prizes.map((prize) => prize.label.toUpperCase())
      : ["WAIT"];

    reels.forEach((reel) => reel.classList.add("slot-reel-spinning"));

    for (let reelIndex = 0; reelIndex < reels.length; reelIndex += 1) {
      for (let step = 0; step < 12 + reelIndex * 4; step += 1) {
        reels[reelIndex].textContent = labels[(step + reelIndex) % labels.length];
        await wait(90);
      }

      reels[reelIndex].textContent = resultLabel.toUpperCase();
      await wait(140);
      reels[reelIndex].classList.remove("slot-reel-spinning");
      reels[reelIndex].classList.add("slot-reel-hit");
      await wait(120);
      reels[reelIndex].classList.remove("slot-reel-hit");
    }
  }

  async function refreshWheelData() {
    user = await getCurrentUser();
    if (user.role === "admin") {
      goTo("/home.html");
      return;
    }

    applyPlayerStyle(user);
    const statusData = await api("/api/wheel-status", { method: "GET" });
    wheelStatus = {
      tickets: statusData.tickets,
      canClaim: statusData.canClaim,
      mondayOpen: statusData.mondayOpen,
      prizes: statusData.prizes,
    };
    renderStatus();
    renderPrizeGrid();
  }

  async function claimTicket() {
    clearMessage(message);

    try {
      const data = await api("/api/wheel-claim", { method: "POST" });
      wheelStatus.tickets = data.tickets;
      wheelStatus.canClaim = data.canClaim;
      renderStatus();
      setMessage(message, data.message);
    } catch (error) {
      setMessage(message, error.message, "error");
    }
  }

  async function spinWheel() {
    if (spinning) {
      return;
    }

    clearMessage(message);
    spinning = true;
    renderStatus();

    try {
      const data = await api("/api/wheel-spin", {
        method: "POST",
      });

      await animateSlotMachine(data.result.label);
      user = data.user;
      savePlayerStyle(user);
      wheelStatus.tickets = data.tickets;
      wheelResultText.textContent =
        `${data.result.label}: ${data.result.pointChange >= 0 ? "won" : "lost"} ` +
        `${Math.abs(data.result.pointChange)} points at ${data.result.oddsPercent}% odds.`;
      await refreshWheelData();
      renderStatus();
      setMessage(message, data.message);
    } catch (error) {
      setMessage(message, error.message, "error");
    } finally {
      spinning = false;
      renderStatus();
    }
  }

  claimTicketButton.addEventListener("click", () => {
    claimTicket();
  });

  spinButton.addEventListener("click", () => {
    spinWheel();
  });

  logoutButton.addEventListener("click", () => {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    logout();
  });

  refreshWheelData().catch((error) => {
    setMessage(message, error.message || "Please log in first.", "error");
    setTimeout(() => {
      window.location.href = "/index.html";
    }, 1000);
  });

  refreshTimer = setInterval(() => {
    if (!spinning) {
      refreshWheelData().catch(() => {});
    }
  }, 10000);
}

function initSettingsPage() {
  const message = document.getElementById("message");
  const themeSelect = document.getElementById("themeSelect");
  const profileLetterInput = document.getElementById("profileLetterInput");
  const clickEffectSelect = document.getElementById("clickEffectSelect");
  const previewEffectButton = document.getElementById("previewEffectButton");
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
    document.body.dataset.clickEffect = clickEffectSelect.value;
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
    clickEffectSelect.value = data.settings.clickEffect;
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
          clickEffect: clickEffectSelect.value,
        }),
      });

      user = data.user;
      savePlayerStyle(data.user);
      themeSelect.value = data.settings.theme;
      profileLetterInput.value = data.settings.profileLetter;
      clickEffectSelect.value = data.settings.clickEffect;
      syncPreview();
      setMessage(message, data.message);
    } catch (error) {
      setMessage(message, error.message, "error");
    }
  }

  themeSelect.addEventListener("change", syncPreview);
  clickEffectSelect.addEventListener("change", syncPreview);
  profileLetterInput.addEventListener("input", () => {
    profileLetterInput.value = String(profileLetterInput.value || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 1);
    syncPreview();
  });
  previewEffectButton.addEventListener("click", async () => {
    clearMessage(message);
    if (clickEffectSelect.value === "none") {
      setMessage(message, "Choose Fade or Snap to preview an interactive effect.", "error");
      return;
    }
    await triggerPageEffect(clickEffectSelect.value, "preview");
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
  installInteractiveLinks();
  primeSavedStyle();
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
