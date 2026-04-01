# Memory Game — Online Multiplayer

Real-time Hebrew memory card game. Players join from any device using a 4-letter room code.

## Structure

```
memory-game/
├── backend/   → Render (Node.js + Socket.io)
└── frontend/  → Vercel (static HTML)
```

## Deploy

### 1. Push to Git (if not already)

```bash
git add memory-game/
git commit -m "feat: add online memory game"
git push
```

### 2. Deploy Backend to Render

1. Go to [render.com](https://render.com) → **New Web Service**
2. Connect your repo, set **Root Directory** to `memory-game/backend`
3. Settings:
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. Click **Deploy** — copy the URL (e.g. `https://memory-game-backend.onrender.com`)

### 3. Update the frontend URL

In `frontend/index.html`, find this line (~line 290) and replace the placeholder:

```js
: 'https://memory-game-backend.onrender.com' // TODO: replace after Render deploy
```

Replace with your actual Render URL.

### 4. Deploy Frontend to Vercel

1. Go to [vercel.com](https://vercel.com) → **New Project**
2. Connect your repo, set **Root Directory** to `memory-game/frontend`
3. No build command needed (pure static HTML)
4. Click **Deploy**

## Local Development

**Backend:**
```bash
cd memory-game/backend
npm install
npm run dev   # runs on port 3002
```

**Frontend:**
Open `memory-game/frontend/index.html` directly in a browser — it auto-connects to `localhost:3002`.

## How to play

1. One player clicks **Create Game**, sets topic/cards/rounds, shares the 4-letter code
2. Other players open the app, click **Join Game**, enter the code
3. Host clicks **Start Game**
4. Players take turns flipping pairs — turn advances on a miss, same player continues on a match
5. After all rounds, the player with the most matched pairs wins
