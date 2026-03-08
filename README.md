# ⚔ Declare Duel — Online Multiplayer

A real-time 1v1 online card bluffing game built with Node.js + Socket.io.

---

## 🚀 Quick Start (Local)

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start

# 3. Open your browser
# Player 1: http://localhost:3000
# Player 2: http://localhost:3000  (different tab or device on same network)
```

---

## ☁️ Deploy Free Online (Pick One)

### Option A — Railway (Easiest, recommended)

1. Push this folder to a GitHub repo
2. Go to https://railway.app → **New Project** → **Deploy from GitHub**
3. Select your repo — Railway auto-detects Node.js
4. Click **Deploy** — done! You'll get a public URL like `https://declare-duel.up.railway.app`

### Option B — Render

1. Push to GitHub
2. Go to https://render.com → **New Web Service**
3. Connect your GitHub repo
4. Set:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
5. Click **Create Web Service** — free tier works fine

### Option C — Run locally + share via ngrok

```bash
# Install ngrok (https://ngrok.com)
npm start &
ngrok http 3000
# Share the ngrok HTTPS URL with your friend
```

---

## 🎮 How to Play

1. Both players open the URL and enter their names
2. Click **Find Match** — matchmaking is automatic
3. **Play Phase:** Each player selects a card and declares a value (can lie!)
4. **Call Phase:** Player 1 decides: call the opponent's bluff, or pass. Then Player 2 decides.
5. **Resolve:**
   - Correct bluff call → caller keeps card, accused loses theirs
   - Wrong bluff call → caller loses their card
   - No calls → higher actual card wins; loser discards
6. First to **5 round wins** takes the duel!

---

## 🗂 Project Structure

```
declare-duel/
├── server.js          # Node.js + Socket.io game server
├── public/
│   └── index.html     # Full game client (HTML/CSS/JS + Audio)
├── package.json
├── railway.toml       # Railway deployment config
├── render.yaml        # Render deployment config
├── Procfile           # Heroku/Railway Procfile
└── README.md
```

---

## 🔧 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT`   | `3000`  | Server port |

---

## 🛠 Tech Stack

- **Backend:** Node.js, Express, Socket.io, uuid
- **Frontend:** Vanilla HTML/CSS/JS, Web Audio API (procedural BGM + SFX)
- **Transport:** WebSockets (via Socket.io)
