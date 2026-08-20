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

  const systemPrompt = `Tu es un extracteur de données. On te donne le texte brut d'une page web et une demande de l'utilisateur.
Réponds UNIQUEMENT avec un tableau JSON de tableaux (lignes), où la première ligne contient les en-têtes de colonnes.
Ne mets aucun texte avant ou après, aucun bloc markdown, uniquement le JSON brut.
Si aucune donnée pertinente n'est trouvée, réponds avec [["Résultat"],["Aucune donnée trouvée"]].`;

  const userMessage = `Demande de l'utilisateur : ${query}\n\nContenu de la page :\n${pageText.slice(0, 15000)}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Erreur API Claude (${response.status}) : ${errText.slice(0, 200)}`);
    }

    const data = await response.json();
    const textBlock = (data.content || []).find((b) => b.type === "text");
    if (!textBlock) throw new Error("Réponse vide de l'API.");

    const cleaned = textBlock.text.replace(/```json/g, "").replace(/```/g, "").trim();
    const rows = JSON.parse(cleaned);

    if (!user.subscribed) {
      updateUser(deviceId, { usedCount: user.usedCount + 1 });
    }

    res.json({ rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "extraction_failed", message: err.message });
  }
});

app.post("/api/create-checkout-session", async (req, res) => {
  const { deviceId } = req.body || {};
  if (!deviceId) return res.status(400).json({ error: "deviceId manquant" });

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      client_reference_id: deviceId,
      success_url: process.env.SUCCESS_URL,
      cancel_url: process.env.CANCEL_URL,
         branding_settings: {
        display_name: "Extracteur de Données",
        icon: {
          type: "file",
          file: "file_1U6WuuRtznai6KcvyaIs1Re6",
        },
        background_color: "#6366f1",
        button_color: "#6366f1",
      },
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "checkout_failed", message: err.message });
  }
});

app.get("/", (req, res) => {
  res.send("Serveur Extracteur de Données — OK");
});



 app.get("/", (req, res) => {
  res.send("Serveur Extracteur de Données — OK");
});

app.get("/merci", (req, res) => {

app.get("/merci", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8" />
<title>Abonnement activé — Extracteur de Données</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #fafafa; color: #1a1a1a; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
  .card { background: white; padding: 40px; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); max-width: 420px; }
  h1 { font-size: 22px; margin-bottom: 8px; }
  p { color: #555; font-size: 14px; line-height: 1.6; }
  .check { font-size: 48px; margin-bottom: 12px; }
</style>
</head>
<body>
  <div class="card">
    <div class="check">✅</div>
    <h1>Abonnement activé !</h1>
    <p>Merci pour votre confiance. Vous pouvez fermer cet onglet et retourner sur l'extension Chrome
    "Extracteur de Données" — vos extractions IA sont maintenant illimitées.</p>
  </div>
</body>
</html>`);
});

app.get("/annule", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8" />
<title>Paiement annulé — Extracteur de Données</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #fafafa; color: #1a1a1a; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
  .card { background: white; padding: 40px; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); max-width: 420px; }
  h1 { font-size: 22px; margin-bottom: 8px; }
  p { color: #555; font-size: 14px; line-height: 1.6; }
</style>
</head>
<body>
  <div class="card">
    <h1>Paiement annulé</h1>
    <p>Aucun montant n'a été débité. Vous pouvez fermer cet onglet et réessayer à tout moment
    depuis l'extension "Extracteur de Données".</p>
  </div>
</body>
</html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur démarré sur le port ${PORT}`));
