# Serveur Extracteur de Données — Backend

Ce petit serveur fait deux choses :
1. Il garde ta clé API Claude **en sécurité côté serveur** (les utilisateurs de l'extension n'ont plus besoin d'en créer une)
2. Il gère les **abonnements Stripe** : X extractions gratuites, puis abonnement mensuel pour continuer

## Étape 1 — Créer les comptes nécessaires

### Stripe (paiements)
1. Crée un compte sur [stripe.com](https://stripe.com)
2. Dans le Dashboard → **Produits** → crée un produit "Abonnement Extracteur de Données"
   avec un prix récurrent mensuel (ex. 4,99€/mois) → note l'ID du prix (`price_...`)
3. Dans **Développeurs → Clés API** → copie ta clé secrète (`sk_test_...` pour tester, `sk_live_...` en prod)
4. Dans **Développeurs → Webhooks** → tu ajouteras l'URL de ton serveur une fois déployé (étape 3)

### Anthropic (déjà fait)
Tu as déjà ta clé API Anthropic créée précédemment — c'est celle-ci qui ira dans `ANTHROPIC_API_KEY`.

## Étape 2 — Configurer les variables d'environnement

Copie `.env.example` en `.env` et remplis toutes les valeurs (clé Anthropic, clés Stripe, ID du prix).

## Étape 3 — Déployer le serveur (gratuit pour démarrer)

**Option recommandée : Render.com**
1. Crée un compte sur [render.com](https://render.com)
2. **New +** → **Web Service** → connecte ton dépôt GitHub (il faut d'abord pousser ce dossier sur GitHub)
   ou utilise l'option "Déployer sans Git" si disponible
3. Render détecte Node.js automatiquement. Configure :
   - Build command : `npm install`
   - Start command : `npm start`
4. Dans **Environment**, ajoute toutes les variables du fichier `.env`
5. Déploie → tu obtiens une URL du type `https://extracteur-backend.onrender.com`

**Alternative : Railway.app** — fonctionnement très similaire.

## Étape 4 — Terminer la config Stripe

1. Retourne dans Stripe → **Développeurs → Webhooks → Ajouter un endpoint**
2. URL : `https://ton-serveur.onrender.com/api/stripe-webhook`
3. Écoute les événements : `checkout.session.completed` et `customer.subscription.deleted`
4. Copie le "Signing secret" (`whsec_...`) → ajoute-le à `STRIPE_WEBHOOK_SECRET` sur Render, puis redéploie

## Étape 5 — Brancher l'extension sur ce serveur

Dans le dossier de l'extension (`extracteur-donnees-v3`), ouvre `popup.js` et remplace la ligne :
```js
const BACKEND_URL = "https://TON-SERVEUR.onrender.com";
```
par ta vraie URL Render.

## Tester en local avant de déployer (optionnel)

```bash
npm install
cp .env.example .env   # puis remplis les valeurs
npm start
```
Le serveur tourne sur `http://localhost:3000`. Utilise la carte de test Stripe `4242 4242 4242 4242`
avec n'importe quelle date future et n'importe quel CVC pour simuler un paiement.

## Note importante sur les coûts

- **Render/Railway** : gratuit pour un usage léger, quelques euros/mois si le trafic augmente
- **API Claude (modèle Haiku)** : quelques centimes par extraction, facturés à toi (le serveur)
- **Stripe** : environ 1,5% + 0,25€ de commission par paiement

Fixe ton prix d'abonnement en gardant une marge confortable au-dessus de ces coûts.
