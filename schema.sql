-- Run this manually only if you want to pre-create the D1 tables yourself.
-- The Worker also creates these tables automatically on first request.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'player',
  points INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS shop (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  cost INTEGER NOT NULL,
  category TEXT NOT NULL DEFAULT 'reward'
);

CREATE TABLE IF NOT EXISTS redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  item TEXT NOT NULL,
  cost INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO shop (name, cost, category) VALUES
  ('Plus 1 Goal', 100, 'reward'),
  ('Free Kick', 50, 'reward'),
  ('Gum', 15, 'reward'),
  ('Welchs Juicefuls', 20, 'snack'),
  ('Bear Paw', 50, 'snack'),
  ('Hello Panda', 75, 'snack'),
  ('Cheesestring', 50, 'snack');
