const SESSION_COOKIE = "soccer_points_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;
const DEFAULT_ADMIN_USERNAME = "admin1234";
const DEFAULT_ADMIN_PASSWORD = "gamer@00";
const PASSWORD_ITERATIONS = 100000;
const DEFAULT_SLOT_PRIZES = [
  { label: "Jackpot", pointChange: 60, weight: 4, active: 1 },
  { label: "Big Win", pointChange: 35, weight: 8, active: 1 },
  { label: "Nice Boost", pointChange: 20, weight: 12, active: 1 },
  { label: "Small Win", pointChange: 10, weight: 18, active: 1 },
  { label: "Lucky Save", pointChange: 5, weight: 16, active: 1 },
  { label: "Slip", pointChange: -5, weight: 16, active: 1 },
  { label: "Penalty", pointChange: -15, weight: 14, active: 1 },
  { label: "Big Miss", pointChange: -30, weight: 12, active: 1 },
];

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
  const route = pathname.replace(/^\/api/, "") || "/";

  if (pathname === "/health") {
    return json({ success: true, database: "d1" });
  }

  if (route === "/auth/register" && request.method === "POST") {
    return handleBrowserRegister(request, env);
  }

  if (route === "/auth/login" && request.method === "POST") {
    return handleBrowserLogin(request, env);
  }

  if (route === "/logout" && request.method === "POST") {
    return clearSessionAndRedirect();
  }

  if (route === "/register" && request.method === "POST") {
    const body = await request.json();
    const result = await registerUser(env, body.username, body.password);
    return json({ success: true, user: result.user });
  }

  if (route === "/login" && request.method === "POST") {
    const body = await request.json();
    const result = await loginUser(env, body.username, body.password);
    return json({ success: true, user: result.user });
  }

  if (route === "/me" && request.method === "GET") {
    const user = await requireUser(request, env);
    return json({ success: true, user });
  }

  if (route === "/settings" && request.method === "GET") {
    const user = await requireUser(request, env);
    return json({ success: true, settings: buildUserSettings(user) });
  }

  if (route === "/settings" && request.method === "POST") {
    const user = await requireUser(request, env);
    const body = await request.json();
    const theme = normalizeTheme(body.theme);
    const profileLetter = normalizeProfileLetter(body.profileLetter);
    const clickEffect = normalizeClickEffect(body.clickEffect);

    await dbRun(
      env,
      "UPDATE users SET theme = ?, profile_letter = ?, click_effect = ? WHERE id = ?",
      [theme, profileLetter, clickEffect, user.id]
    );

    const updatedUser = await dbGet(
      env,
      `SELECT id, username, role, points, theme, profile_letter, click_effect
       FROM users
       WHERE id = ?`,
      [user.id]
    );

    return json({
      success: true,
      message: "Saved your player settings",
      user: normalizeUser(updatedUser),
      settings: buildUserSettings(updatedUser),
    });
  }

  if (route === "/users" && request.method === "GET") {
    const user = await requireAdmin(request, env);
    void user;
    const users = await dbAll(
      env,
      `SELECT u.id, u.username, u.role, u.points, COALESCE(wt.tickets, 0) AS tickets
       FROM users u
       LEFT JOIN wheel_tickets wt ON wt.user_id = u.id
       ORDER BY u.role DESC, u.username ASC`
    );
    return json({
      success: true,
      users: users.map(normalizeUser),
    });
  }

  if (route === "/users/delete" && request.method === "POST") {
    await requireAdmin(request, env);
    const body = await request.json();
    const username = String(body.username || "").trim();

    if (!username) {
      return json({ success: false, message: "Username is required" }, 400);
    }

    const target = await dbGet(
      env,
      "SELECT id, username, role FROM users WHERE username = ?",
      [username]
    );

    if (!target) {
      return json({ success: false, message: "User not found" }, 404);
    }

    if (target.role === "admin") {
      return json(
        { success: false, message: "Admin accounts cannot be deleted here" },
        400
      );
    }

    await dbRun(env, "DELETE FROM wheel_tickets WHERE user_id = ?", [target.id]);
    await dbRun(
      env,
      "DELETE FROM point_requests WHERE requester_id = ? OR recipient_id = ?",
      [target.id, target.id]
    );
    await dbRun(env, "DELETE FROM users WHERE id = ?", [target.id]);

    return json({
      success: true,
      message: `Deleted account ${target.username}`,
    });
  }

  if (route === "/leaderboard" && request.method === "GET") {
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

  if (route === "/points" && request.method === "POST") {
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

  if (route === "/tickets" && request.method === "POST") {
    await requireAdmin(request, env);
    const body = await request.json();
    const username = String(body.username || "").trim();
    const amount = Number(body.amount);

    if (!username || !Number.isInteger(amount) || amount === 0) {
      return json(
        { success: false, message: "Username and a whole-number ticket amount are required" },
        400
      );
    }

    const target = await dbGet(
      env,
      "SELECT id, username, role FROM users WHERE username = ?",
      [username]
    );

    if (!target) {
      return json({ success: false, message: "User not found" }, 404);
    }

    if (target.role !== "player") {
      return json(
        { success: false, message: "Only player accounts can receive slot tickets" },
        400
      );
    }

    const ticketState = await getWheelTicketState(env, target.id);
    const nextTickets = Math.max(0, ticketState.tickets + amount);

    await dbRun(
      env,
      "UPDATE wheel_tickets SET tickets = ? WHERE user_id = ?",
      [nextTickets, target.id]
    );

    return json({
      success: true,
      message: `${amount > 0 ? "Added" : "Removed"} ${Math.abs(amount)} slot ticket${Math.abs(amount) === 1 ? "" : "s"} for ${target.username}`,
      tickets: nextTickets,
    });
  }

  if (route === "/shop" && request.method === "GET") {
    await requireUser(request, env);
    const items = await dbAll(
      env,
      `SELECT id, name, cost, category, out_of_stock, stock_note
       FROM shop
       ORDER BY category ASC, cost ASC, name ASC`
    );
    return json({
      success: true,
      items: items.map((item) => ({
        id: Number(item.id),
        name: item.name,
        cost: Number(item.cost),
        category: item.category,
        outOfStock: Boolean(Number(item.out_of_stock)),
        stockNote: item.stock_note || "",
      })),
    });
  }

  if (route === "/shop/update" && request.method === "POST") {
    await requireAdmin(request, env);
    const body = await request.json();
    const itemId = Number(body.itemId);
    const name = String(body.name || "").trim();
    const cost = Number(body.cost);
    const category = normalizeShopCategory(body.category);
    const outOfStock = Boolean(body.outOfStock);
    const stockNote = String(body.stockNote || "").trim();

    if (!name || Number.isNaN(itemId) || Number.isNaN(cost) || cost < 0) {
      return json(
        { success: false, message: "Item name and price are required" },
        400
      );
    }

    const item = await dbGet(
      env,
      "SELECT id, name FROM shop WHERE id = ?",
      [itemId]
    );

    if (!item) {
      return json({ success: false, message: "Item not found" }, 404);
    }

    const nextNote = outOfStock ? stockNote || "Out of stock" : "";
    try {
      await dbRun(
        env,
        `UPDATE shop
         SET name = ?, cost = ?, category = ?, out_of_stock = ?, stock_note = ?
         WHERE id = ?`,
        [name, Math.round(cost), category, outOfStock ? 1 : 0, nextNote, itemId]
      );
    } catch (error) {
      if (String(error.message || "").includes("UNIQUE")) {
        return json(
          { success: false, message: "That shop item name is already in use" },
          409
        );
      }
      throw error;
    }

    return json({
      success: true,
      message: `Updated ${name}`,
    });
  }

  if (route === "/shop/create" && request.method === "POST") {
    await requireAdmin(request, env);
    const body = await request.json();
    const name = String(body.name || "").trim();
    const cost = Number(body.cost);
    const category = normalizeShopCategory(body.category);

    if (!name || Number.isNaN(cost) || cost < 0) {
      return json(
        { success: false, message: "Item name and price are required" },
        400
      );
    }

    try {
      await dbRun(
        env,
        `INSERT INTO shop (name, cost, category, out_of_stock, stock_note)
         VALUES (?, ?, ?, 0, '')`,
        [name, Math.round(cost), category]
      );
    } catch (error) {
      if (String(error.message || "").includes("UNIQUE")) {
        return json(
          { success: false, message: "That shop item already exists" },
          409
        );
      }
      throw error;
    }

    return json({
      success: true,
      message: `Added ${name} to the shop`,
    });
  }

  if (route === "/shop/delete" && request.method === "POST") {
    await requireAdmin(request, env);
    const body = await request.json();
    const itemId = Number(body.itemId);

    if (Number.isNaN(itemId)) {
      return json({ success: false, message: "A valid item is required" }, 400);
    }

    const item = await dbGet(env, "SELECT id, name FROM shop WHERE id = ?", [itemId]);
    if (!item) {
      return json({ success: false, message: "Item not found" }, 404);
    }

    await dbRun(env, "DELETE FROM shop WHERE id = ?", [itemId]);

    return json({
      success: true,
      message: `Deleted ${item.name}`,
    });
  }

  if (route === "/wheel-status" && request.method === "GET") {
    const user = await requireUser(request, env);

    if (user.role === "admin") {
      return json(
        { success: false, message: "Admins cannot use the weekly slot machine" },
        403
      );
    }

    const ticketState = await getWheelTicketState(env, user.id);
    const prizes = await getWheelPrizes(env, true);
    const today = getTorontoDateString();
    const mondayOpen = isTorontoMonday();
    return json({
      success: true,
      tickets: ticketState.tickets,
      canClaim: mondayOpen && ticketState.last_claimed_date !== today,
      mondayOpen,
      prizes,
    });
  }

  if (route === "/wheel-config" && request.method === "GET") {
    await requireAdmin(request, env);
    const prizes = await getWheelPrizes(env, false);
    return json({
      success: true,
      prizes,
    });
  }

  if (route === "/wheel-config" && request.method === "POST") {
    await requireAdmin(request, env);
    const body = await request.json();
    const rawPrizes = Array.isArray(body.prizes) ? body.prizes.slice(0, 8) : [];

    if (rawPrizes.length !== 8) {
      return json(
        {
          success: false,
          message: "Set all 8 slot prizes before saving",
        },
        400
      );
    }

    const prizes = rawPrizes.map((prize, index) => {
      const label = String(prize.label || "").trim().slice(0, 40);
      const pointChange = Number(prize.pointChange);
      const weight = Number(prize.weight);
      const active = prize.active ? 1 : 0;

      if (
        !label ||
        !Number.isInteger(pointChange) ||
        pointChange < -500 ||
        pointChange > 500 ||
        !Number.isInteger(weight) ||
        weight < 1 ||
        weight > 1000
      ) {
        throw withStatus(
          `Prize ${index + 1} needs a name, a point change from -500 to 500, and an odds weight from 1 to 1000`,
          400
        );
      }

      return {
        slotIndex: index,
        label,
        pointChange,
        weight,
        active,
      };
    });

    if (!prizes.some((prize) => prize.active === 1)) {
      return json(
        { success: false, message: "At least 1 slot prize must stay active" },
        400
      );
    }

    for (const prize of prizes) {
      await dbRun(
        env,
        `INSERT INTO wheel_config (slot_index, label, point_change, weight, active)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(slot_index) DO UPDATE SET
           label = excluded.label,
           point_change = excluded.point_change,
           weight = excluded.weight,
           active = excluded.active`,
        [
          prize.slotIndex,
          prize.label,
          prize.pointChange,
          prize.weight,
          prize.active,
        ]
      );
    }

    return json({
      success: true,
      message: "Updated the weekly slot machine",
      prizes: await getWheelPrizes(env, false),
    });
  }

  if (route === "/wheel-claim" && request.method === "POST") {
    const user = await requireUser(request, env);

    if (user.role === "admin") {
      return json(
        { success: false, message: "Admins cannot use the weekly slot machine" },
        403
      );
    }

    const today = getTorontoDateString();
    const ticketState = await getWheelTicketState(env, user.id);

    if (!isTorontoMonday()) {
      return json(
        { success: false, message: "Weekly tickets unlock on Mondays only" },
        400
      );
    }

    if (ticketState.last_claimed_date === today) {
      return json(
        { success: false, message: "You already claimed this Monday's ticket" },
        400
      );
    }

    const nextTickets = ticketState.tickets + 1;
    await dbRun(
      env,
      `INSERT INTO wheel_tickets (user_id, tickets, last_claimed_date)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         tickets = excluded.tickets,
         last_claimed_date = excluded.last_claimed_date`,
      [user.id, nextTickets, today]
    );

    return json({
      success: true,
      message: "You claimed this week's slot ticket",
      tickets: nextTickets,
      canClaim: false,
    });
  }

  if (route === "/wheel-spin" && request.method === "POST") {
    const user = await requireUser(request, env);

    if (user.role === "admin") {
      return json(
        { success: false, message: "Admins cannot use the weekly slot machine" },
        403
      );
    }

    const freshUser = await dbGet(
      env,
      "SELECT id, username, role, points FROM users WHERE id = ?",
      [user.id]
    );
    const ticketState = await getWheelTicketState(env, user.id);

    if (ticketState.tickets < 1) {
      return json(
        { success: false, message: "Claim this week's ticket before spinning" },
        400
      );
    }

    const prizes = await getWheelPrizes(env, true);

    if (prizes.length === 0) {
      return json(
        { success: false, message: "The slot machine does not have any active prizes yet" },
        400
      );
    }

    const selectedPrize = chooseWeightedPrize(prizes);
    const pointChange = selectedPrize.pointChange;
    const nextPoints = Number(freshUser.points) + pointChange;
    const nextTickets = ticketState.tickets - 1;

    await dbRun(env, "UPDATE users SET points = ? WHERE id = ?", [
      nextPoints,
      freshUser.id,
    ]);
    await dbRun(env, "UPDATE wheel_tickets SET tickets = ? WHERE user_id = ?", [
      nextTickets,
      freshUser.id,
    ]);

    return json({
      success: true,
      message: `Slot result: ${selectedPrize.label}`,
      result: {
        slotIndex: selectedPrize.slotIndex,
        label: selectedPrize.label,
        pointChange,
        oddsPercent: selectedPrize.oddsPercent,
      },
      tickets: nextTickets,
      user: {
        ...normalizeUser(freshUser),
        points: nextPoints,
      },
    });
  }

  if (route === "/redeem" && request.method === "POST") {
    const user = await requireUser(request, env);
    const body = await request.json();
    const itemId = Number(body.itemId);

    if (Number.isNaN(itemId)) {
      return json({ success: false, message: "A valid item is required" }, 400);
    }

      const item = await dbGet(
        env,
        "SELECT id, name, cost, out_of_stock, stock_note FROM shop WHERE id = ?",
        [itemId]
      );

      if (!item) {
        return json({ success: false, message: "Item not found" }, 404);
      }

      if (Number(item.out_of_stock) === 1) {
        return json(
          {
            success: false,
            message: item.stock_note || "This item is out of stock",
          },
          400
        );
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
      `INSERT INTO redemptions (username, item, cost)
       VALUES (?, ?, ?)`,
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

  if (route === "/redemptions" && request.method === "GET") {
    await requireAdmin(request, env);
    const logs = await dbAll(
      env,
      `SELECT id, username, item, cost, created_at
       FROM redemptions
       ORDER BY id DESC`
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

  if (route === "/redemptions/delete" && request.method === "POST") {
    await requireAdmin(request, env);
    const body = await request.json();
    const redemptionId = Number(body.redemptionId);

    if (Number.isNaN(redemptionId)) {
      return json(
        { success: false, message: "A valid redemption log is required" },
        400
      );
    }

    const redemption = await dbGet(
      env,
      "SELECT id, item FROM redemptions WHERE id = ?",
      [redemptionId]
    );

    if (!redemption) {
      return json({ success: false, message: "Log entry not found" }, 404);
    }

    await dbRun(
      env,
      "DELETE FROM redemptions WHERE id = ?",
      [redemptionId]
    );

    return json({
      success: true,
      message: `Removed ${redemption.item} from the purchase list`,
    });
  }

  if (route === "/point-requests" && request.method === "GET") {
    const user = await requireUser(request, env);

    if (user.role === "admin") {
      return json(
        { success: false, message: "Admins do not use player point requests" },
        403
      );
    }

    const today = getTorontoDateString();
    const recipients = await dbAll(
      env,
      `SELECT username, points
       FROM users
       WHERE role = 'player' AND id != ?
       ORDER BY username ASC`,
      [user.id]
    );
    const incoming = await dbAll(
      env,
      `SELECT pr.id, pr.amount, pr.status, pr.created_at, u.username AS requester_name
       FROM point_requests pr
       JOIN users u ON u.id = pr.requester_id
       WHERE pr.recipient_id = ? AND pr.status = 'pending'
       ORDER BY pr.id DESC`,
      [user.id]
    );
    const outgoing = await dbAll(
      env,
      `SELECT pr.id, pr.amount, pr.status, pr.request_date, pr.created_at, pr.responded_at,
              u.username AS recipient_name
       FROM point_requests pr
       JOIN users u ON u.id = pr.recipient_id
       WHERE pr.requester_id = ?
       ORDER BY pr.id DESC
       LIMIT 8`,
      [user.id]
    );
    const sentToday = await dbGet(
      env,
      `SELECT COUNT(*) AS count
       FROM point_requests
       WHERE requester_id = ? AND request_date = ?`,
      [user.id, today]
    );

    return json({
      success: true,
      canSendToday: Number(sentToday.count) === 0,
      recipients: recipients.map((entry) => ({
        username: entry.username,
        points: Number(entry.points),
      })),
      incoming: incoming.map((entry) => ({
        id: Number(entry.id),
        amount: Number(entry.amount),
        status: entry.status,
        created_at: entry.created_at,
        requesterName: entry.requester_name,
      })),
      outgoing: outgoing.map((entry) => ({
        id: Number(entry.id),
        amount: Number(entry.amount),
        status: entry.status,
        request_date: entry.request_date,
        created_at: entry.created_at,
        responded_at: entry.responded_at,
        recipientName: entry.recipient_name,
      })),
    });
  }

  if (route === "/point-requests" && request.method === "POST") {
    const user = await requireUser(request, env);

    if (user.role === "admin") {
      return json(
        { success: false, message: "Admins do not use player point requests" },
        403
      );
    }

    const body = await request.json();
    const recipientUsername = String(body.recipientUsername || "").trim();
    const amount = Number(body.amount);
    const today = getTorontoDateString();

    if (!recipientUsername || !Number.isInteger(amount) || amount <= 0) {
      return json(
        { success: false, message: "Choose a player and enter a whole-number amount" },
        400
      );
    }

    const sentToday = await dbGet(
      env,
      `SELECT COUNT(*) AS count
       FROM point_requests
       WHERE requester_id = ? AND request_date = ?`,
      [user.id, today]
    );

    if (Number(sentToday.count) > 0) {
      return json(
        { success: false, message: "You can only ask another player once per day" },
        400
      );
    }

    const recipient = await dbGet(
      env,
      `SELECT id, username, role
       FROM users
       WHERE username = ?`,
      [recipientUsername]
    );

    if (!recipient || recipient.role !== "player") {
      return json({ success: false, message: "That player could not be found" }, 404);
    }

    if (Number(recipient.id) === user.id) {
      return json(
        { success: false, message: "You cannot ask yourself for points" },
        400
      );
    }

    await dbRun(
      env,
      `INSERT INTO point_requests (requester_id, recipient_id, amount, status, request_date)
       VALUES (?, ?, ?, 'pending', ?)`,
      [user.id, recipient.id, amount, today]
    );

    return json({
      success: true,
      message: `Sent a point request to ${recipient.username}`,
    });
  }

  if (route === "/point-requests/respond" && request.method === "POST") {
    const user = await requireUser(request, env);

    if (user.role === "admin") {
      return json(
        { success: false, message: "Admins do not use player point requests" },
        403
      );
    }

    const body = await request.json();
    const requestId = Number(body.requestId);
    const action = String(body.action || "").trim().toLowerCase();

    if (Number.isNaN(requestId) || !["approve", "reject"].includes(action)) {
      return json(
        { success: false, message: "A valid request and action are required" },
        400
      );
    }

    const requestRecord = await dbGet(
      env,
      `SELECT pr.id, pr.amount, pr.status, pr.requester_id, pr.recipient_id,
              requester.username AS requester_name
       FROM point_requests pr
       JOIN users requester ON requester.id = pr.requester_id
       WHERE pr.id = ? AND pr.recipient_id = ?`,
      [requestId, user.id]
    );

    if (!requestRecord) {
      return json({ success: false, message: "Request not found" }, 404);
    }

    if (requestRecord.status !== "pending") {
      return json({ success: false, message: "That request is already closed" }, 400);
    }

    if (action === "reject") {
      await dbRun(
        env,
        `UPDATE point_requests
         SET status = 'rejected', responded_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [requestId]
      );

      return json({
        success: true,
        message: `Rejected ${requestRecord.requester_name}'s request`,
      });
    }

    const recipientFresh = await dbGet(
      env,
      "SELECT id, points FROM users WHERE id = ?",
      [user.id]
    );

    if (Number(recipientFresh.points) < Number(requestRecord.amount)) {
      return json(
        {
          success: false,
          message: `You need ${requestRecord.amount} points to approve this request`,
        },
        400
      );
    }

    const requesterFresh = await dbGet(
      env,
      "SELECT id, points FROM users WHERE id = ?",
      [requestRecord.requester_id]
    );

    await dbRun(
      env,
      "UPDATE users SET points = ? WHERE id = ?",
      [Number(recipientFresh.points) - Number(requestRecord.amount), user.id]
    );
    await dbRun(
      env,
      "UPDATE users SET points = ? WHERE id = ?",
      [Number(requesterFresh.points) + Number(requestRecord.amount), requestRecord.requester_id]
    );
    await dbRun(
      env,
      `UPDATE point_requests
       SET status = 'approved', responded_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [requestId]
    );

    return json({
      success: true,
      message: `Sent ${requestRecord.amount} points to ${requestRecord.requester_name}`,
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
      points INTEGER NOT NULL DEFAULT 0,
      theme TEXT NOT NULL DEFAULT 'default',
      profile_letter TEXT NOT NULL DEFAULT '',
      click_effect TEXT NOT NULL DEFAULT 'none'
    )`
  );

  await dbRun(
    env,
    "ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'default'"
  ).catch(() => {});

  await dbRun(
    env,
    "ALTER TABLE users ADD COLUMN profile_letter TEXT NOT NULL DEFAULT ''"
  ).catch(() => {});

  await dbRun(
    env,
    "ALTER TABLE users ADD COLUMN click_effect TEXT NOT NULL DEFAULT 'none'"
  ).catch(() => {});

  await dbRun(
    env,
    `CREATE TABLE IF NOT EXISTS shop (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      cost INTEGER NOT NULL,
      category TEXT NOT NULL DEFAULT 'reward',
      out_of_stock INTEGER NOT NULL DEFAULT 0,
      stock_note TEXT NOT NULL DEFAULT ''
    )`
  );

  await dbRun(
    env,
    "ALTER TABLE shop ADD COLUMN out_of_stock INTEGER NOT NULL DEFAULT 0"
  ).catch(() => {});

  await dbRun(
    env,
    "ALTER TABLE shop ADD COLUMN stock_note TEXT NOT NULL DEFAULT ''"
  ).catch(() => {});

  await dbRun(
    env,
    `CREATE TABLE IF NOT EXISTS redemptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      item TEXT NOT NULL,
      cost INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT,
      keep_forever INTEGER NOT NULL DEFAULT 0
    )`
  );

  await dbRun(
    env,
    "ALTER TABLE redemptions ADD COLUMN expires_at TEXT"
  ).catch(() => {});

  await dbRun(
    env,
    "ALTER TABLE redemptions ADD COLUMN keep_forever INTEGER NOT NULL DEFAULT 0"
  ).catch(() => {});

  await dbRun(
    env,
    `CREATE TABLE IF NOT EXISTS wheel_tickets (
      user_id INTEGER PRIMARY KEY,
      tickets INTEGER NOT NULL DEFAULT 0,
      last_claimed_date TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`
  );

  await dbRun(
    env,
    `CREATE TABLE IF NOT EXISTS wheel_config (
      slot_index INTEGER PRIMARY KEY,
      percent INTEGER NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      point_change INTEGER NOT NULL DEFAULT 0,
      weight INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1
    )`
  );

  await dbRun(
    env,
    "ALTER TABLE wheel_config ADD COLUMN label TEXT NOT NULL DEFAULT ''"
  ).catch(() => {});

  await dbRun(
    env,
    "ALTER TABLE wheel_config ADD COLUMN point_change INTEGER NOT NULL DEFAULT 0"
  ).catch(() => {});

  await dbRun(
    env,
    "ALTER TABLE wheel_config ADD COLUMN weight INTEGER NOT NULL DEFAULT 1"
  ).catch(() => {});

  await dbRun(
    env,
    "ALTER TABLE wheel_config ADD COLUMN active INTEGER NOT NULL DEFAULT 1"
  ).catch(() => {});

  await dbRun(
    env,
    `CREATE TABLE IF NOT EXISTS point_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id INTEGER NOT NULL,
      recipient_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      request_date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      responded_at TEXT,
      FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
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

  for (let index = 0; index < DEFAULT_SLOT_PRIZES.length; index += 1) {
    const defaultPrize = DEFAULT_SLOT_PRIZES[index];
    const existingPrize = await dbGet(
      env,
      "SELECT slot_index, percent, label, point_change, weight, active FROM wheel_config WHERE slot_index = ?",
      [index]
    );

    if (!existingPrize) {
      await dbRun(
        env,
        `INSERT INTO wheel_config (slot_index, percent, label, point_change, weight, active)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          index,
          defaultPrize.pointChange,
          defaultPrize.label,
          defaultPrize.pointChange,
          defaultPrize.weight,
          defaultPrize.active,
        ]
      );
      continue;
    }

    const hasModernSlotFields = String(existingPrize.label || "").trim().length > 0;
    const nextLabel = hasModernSlotFields
      ? String(existingPrize.label || "").trim()
      : defaultPrize.label;
    const nextPointChange = hasModernSlotFields
      ? Number(existingPrize.point_change)
      : Number(existingPrize.percent || defaultPrize.pointChange);
    const nextWeight = hasModernSlotFields
      ? Math.max(1, Number(existingPrize.weight || defaultPrize.weight))
      : defaultPrize.weight;
    const nextActive = hasModernSlotFields
      ? (Number(existingPrize.active ?? defaultPrize.active) ? 1 : 0)
      : defaultPrize.active;

    await dbRun(
      env,
      `UPDATE wheel_config
       SET label = ?, point_change = ?, weight = ?, active = ?
       WHERE slot_index = ?`,
      [nextLabel, nextPointChange, nextWeight, nextActive, index]
    );
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
    `SELECT id, username, role, points, theme, profile_letter, click_effect
     FROM users
     WHERE id = ?`,
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
    tickets: Number(user.tickets || 0),
    theme: normalizeTheme(user.theme),
    profileLetter: normalizeProfileLetter(user.profile_letter, user.username),
    clickEffect: normalizeClickEffect(user.click_effect),
  };
}

function buildUserSettings(user) {
  const normalized = normalizeUser(user);
  return {
    theme: normalized.theme,
    profileLetter: normalized.profileLetter,
    clickEffect: normalized.clickEffect,
    themeOptions: ["default", "sunset", "forest", "ocean", "aurora", "midnight", "rose", "ember"],
    clickEffectOptions: ["none", "fade", "snap"],
  };
}

async function getWheelTicketState(env, userId) {
  const ticketState = await dbGet(
    env,
    "SELECT tickets, last_claimed_date FROM wheel_tickets WHERE user_id = ?",
    [userId]
  );

  if (ticketState) {
    return {
      tickets: Number(ticketState.tickets),
      last_claimed_date: ticketState.last_claimed_date || "",
    };
  }

  await dbRun(
    env,
    "INSERT INTO wheel_tickets (user_id, tickets, last_claimed_date) VALUES (?, 0, NULL)",
    [userId]
  );

  return {
    tickets: 0,
    last_claimed_date: "",
  };
}

async function getWheelPrizes(env, activeOnly = false) {
  const rows = await dbAll(
    env,
    `SELECT slot_index, label, point_change, weight, active
     FROM wheel_config
     ORDER BY slot_index ASC`
  );
  const seededRows = [];

  for (let index = 0; index < DEFAULT_SLOT_PRIZES.length; index += 1) {
    const row = rows.find((entry) => Number(entry.slot_index) === index);
    const fallback = DEFAULT_SLOT_PRIZES[index];
    const prize = {
      slotIndex: index,
      label: String(row?.label || "").trim() || fallback.label,
      pointChange: Number.isFinite(Number(row?.point_change))
        ? Number(row.point_change)
        : fallback.pointChange,
      weight: Math.max(1, Number(row?.weight || fallback.weight)),
      active: row ? Boolean(Number(row.active)) : Boolean(fallback.active),
    };
    seededRows.push(prize);
  }

  const activeRows = seededRows.filter((prize) => prize.active);
  const totalWeight = activeRows.reduce((sum, prize) => sum + prize.weight, 0) || 1;

  const mapped = seededRows.map((prize) => ({
    ...prize,
    oddsPercent: prize.active ? Number(((prize.weight / totalWeight) * 100).toFixed(1)) : 0,
  }));

  return activeOnly ? mapped.filter((prize) => prize.active) : mapped;
}

function chooseWeightedPrize(prizes) {
  const totalWeight = prizes.reduce((sum, prize) => sum + prize.weight, 0);
  let pick = crypto.getRandomValues(new Uint32Array(1))[0] % totalWeight;

  for (const prize of prizes) {
    if (pick < prize.weight) {
      return prize;
    }
    pick -= prize.weight;
  }

  return prizes[prizes.length - 1];
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

function getTorontoDateString() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === "year")?.value || "0000";
  const month = parts.find((part) => part.type === "month")?.value || "00";
  const day = parts.find((part) => part.type === "day")?.value || "00";
  return `${year}-${month}-${day}`;
}

function isTorontoMonday() {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Toronto",
    weekday: "long",
  }).format(new Date()) === "Monday";
}

function normalizeShopCategory(value) {
  return String(value || "").trim().toLowerCase() === "snack" ? "snack" : "reward";
}

function normalizeTheme(value) {
  const theme = String(value || "").trim().toLowerCase();
  if (["sunset", "forest", "ocean", "aurora", "midnight", "rose", "ember"].includes(theme)) {
    return theme;
  }
  return "default";
}

function normalizeClickEffect(value) {
  const effect = String(value || "").trim().toLowerCase();
  if (["fade", "snap"].includes(effect)) {
    return effect;
  }
  return "none";
}

function normalizeProfileLetter(value, username = "") {
  const source = String(value || "").trim() || String(username || "").trim();
  const first = source.charAt(0).toUpperCase();
  return /^[A-Z0-9]$/.test(first) ? first : "P";
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
