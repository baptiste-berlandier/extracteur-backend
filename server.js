require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const Stripe = require("stripe");

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2025-09-30.clover" });

const DB_PATH = path.join(__dirname, "db.json");
const FREE_LIMIT = parseInt(process.env.FREE_LIMIT || "5", 10);

function readDb() {
  if (!fs.existsSync(DB_PATH)) return { users: {} };
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  } catch {
    return { users: {} };
  }
}

function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function getUser(deviceId) {
  const db = readDb();
  if (!db.users[deviceId]) {
    db.users[deviceId] = { usedCount: 0, subscribed: false, stripeCustomerId: null };
    writeDb(db);
  }
  return db.users[deviceId];
}

function updateUser(deviceId, patch) {
  const db = readDb();
  db.users[deviceId] = { ...db.users[deviceId], ...patch };
  writeDb(db);
  return db.users[deviceId];
}

app.post(
  "/api/stripe-webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.headers["stripe-signature"],
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("Signature webhook invalide :", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const deviceId = session.client_reference_id;
      if (deviceId) {
        updateUser(deviceId, { subscribed: true, stripeCustomerId: session.customer });
        console.log(`Abonnement activé pour ${deviceId}`);
      }
    }

    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object;
      const db = readDb();
      const entry = Object.entries(db.users).find(
        ([, u]) => u.stripeCustomerId === subscription.customer
      );
      if (entry) {
        updateUser(entry[0], { subscribed: false });
        console.log(`Abonnement résilié pour ${entry[0]}`);
      }
    }

    res.json({ received: true });
  }
);

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/status", (req, res) => {
  const deviceId = req.query.deviceId;
  if (!deviceId) return res.status(400).json({ error: "deviceId manquant" });

  const user = getUser(deviceId);
  res.json({
    subscribed: user.subscribed,
    freeUsesLeft: user.subscribed ? null : Math.max(0, FREE_LIMIT - user.usedCount),
  });
});

app.post("/api/extract", async (req, res) => {
  const { deviceId, pageText, query } = req.body || {};

  if (!deviceId || !pageText || !query) {
    return res.status(400).json({ error: "Paramètres manquants (deviceId, pageText, query)." });
  }

  const user = getUser(deviceId);

  if (!user.subscribed && user.usedCount >= FREE_LIMIT) {
    return res.status(402).json({
      error: "limit_reached",
      message: "Limite gratuite atteinte. Abonnez-vous pour continuer.",
    });
  }

  const
