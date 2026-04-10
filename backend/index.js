const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.get('/', (_, res) => res.send('Memory Game Server'));
app.get('/health', (_, res) => res.send('OK'));

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

// roomCode -> room
const rooms = new Map();

const PLAYER_COLORS = ['#ff6b6b', '#48d9ff', '#ffd166', '#a8ff78'];
const PAIRS_PER_TOPIC = 16;
const TOPIC_IDS = ['animals', 'food', 'sports', 'space', 'music', 'nature'];

function pickTopicId(settings) {
  if (settings.topicId === 'random') {
    return TOPIC_IDS[Math.floor(Math.random() * TOPIC_IDS.length)];
  }
  return settings.topicId;
}

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildCards(numPairs) {
  // Pick random subset of pair indices from the topic, then shuffle card positions
  const pairIndices = shuffle([...Array(PAIRS_PER_TOPIC).keys()]).slice(0, numPairs);
  const cards = [];
  pairIndices.forEach((pairIndex, pairId) => {
    cards.push({ id: pairId * 2,     pairId, pairIndex });
    cards.push({ id: pairId * 2 + 1, pairId, pairIndex });
  });
  return shuffle(cards);
}

function publicCard({ id, pairId, pairIndex }) {
  return { id, pairId, pairIndex };
}

io.on('connection', socket => {

  // ── Create Room ──────────────────────────────────────────────────────────
  socket.on('createRoom', ({ playerName, settings }) => {
    const code = genCode();
    const player = {
      id: socket.id,
      name: (playerName || 'Host').trim().slice(0, 12),
      color: PLAYER_COLORS[0],
      score: 0,
    };
    rooms.set(code, {
      code,
      hostId: socket.id,
      phase: 'lobby',   // lobby | playing | roundEnd | ended
      players: [player],
      settings,
      gs: null,
    });
    socket.join(code);
    socket.data.code = code;
    socket.emit('roomCreated', { code, players: [player] });
  });

  // ── Join Room ─────────────────────────────────────────────────────────────
  socket.on('joinRoom', ({ roomCode, playerName }) => {
    const code = (roomCode || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room)                    return socket.emit('joinError', 'חדר לא נמצא');
    if (room.phase !== 'lobby')   return socket.emit('joinError', 'המשחק כבר התחיל');
    if (room.players.length >= 4) return socket.emit('joinError', 'החדר מלא (מקסימום 4 שחקנים)');

    const player = {
      id: socket.id,
      name: (playerName || ('שחקן ' + (room.players.length + 1))).trim().slice(0, 12),
      color: PLAYER_COLORS[room.players.length],
      score: 0,
    };
    room.players.push(player);
    socket.join(code);
    socket.data.code = code;

    socket.emit('roomJoined', { code, players: room.players });
    socket.to(code).emit('playerJoined', { players: room.players });
  });

  // ── Start Game ────────────────────────────────────────────────────────────
  socket.on('startGame', () => {
    const room = rooms.get(socket.data.code);
    if (!room || room.hostId !== socket.id) return;
    beginGame(room);
  });

  function beginGame(room, resetScores = true) {
    room.phase = 'playing';
    if (resetScores) room.players.forEach(p => { p.score = 0; });
    const topicId = pickTopicId(room.settings);
    const cards = buildCards(room.settings.numPairs);
    room.gs = {
      cards,
      flipped: [],
      matched: [],
      locked: false,
      currentPlayer: 0,
      round: 1,
      topicId,
    };
    io.to(room.code).emit('gameStarted', {
      cards: cards.map(publicCard),
      settings: room.settings,
      topicId,
      players: room.players,
      currentPlayer: 0,
      round: 1,
      totalRounds: room.settings.totalRounds,
    });
  }

  // ── Flip Card ─────────────────────────────────────────────────────────────
  socket.on('flipCard', ({ cardId }) => {
    const room = rooms.get(socket.data.code);
    if (!room || room.phase !== 'playing') return;

    const gs = room.gs;
    if (gs.locked) return;

    const pidx = room.players.findIndex(p => p.id === socket.id);
    if (pidx !== gs.currentPlayer) return; // not your turn

    if (gs.flipped.includes(cardId)) return;
    const card = gs.cards.find(c => c.id === cardId);
    if (!card || gs.matched.includes(card.pairId)) return;

    gs.flipped.push(cardId);
    io.to(room.code).emit('cardFlipped', { cardId });

    if (gs.flipped.length < 2) return;

    // Two cards flipped — evaluate
    gs.locked = true;
    const [a, b] = gs.flipped.map(id => gs.cards.find(c => c.id === id));

    if (a.pairId === b.pairId) {
      // Match!
      setTimeout(() => {
        gs.matched.push(a.pairId);
        room.players[gs.currentPlayer].score++;
        const cardIds = [...gs.flipped];
        gs.flipped = [];
        gs.locked = false;

        io.to(room.code).emit('pairMatched', {
          cardIds,
          pairId: a.pairId,
          matchedBy: gs.currentPlayer,
          players: room.players,
        });

        if (gs.matched.length === room.settings.numPairs) {
          setTimeout(() => endRound(room), 700);
        }
      }, 500);

    } else {
      // Miss — next player's turn
      setTimeout(() => {
        const cardIds = [...gs.flipped];
        gs.currentPlayer = (gs.currentPlayer + 1) % room.players.length;
        gs.flipped = [];
        gs.locked = false;

        io.to(room.code).emit('pairMissed', { cardIds, nextPlayer: gs.currentPlayer });
      }, 900);
    }
  });

  // ── Round / Game end ──────────────────────────────────────────────────────
  function endRound(room) {
    if (room.gs.round >= room.settings.totalRounds) {
      room.phase = 'ended';
      io.to(room.code).emit('gameEnded', { players: room.players });
    } else {
      room.phase = 'roundEnd';
      io.to(room.code).emit('roundEnded', {
        round: room.gs.round,
        players: room.players,
      });
    }
  }

  // ── Next Round ────────────────────────────────────────────────────────────
  socket.on('nextRound', () => {
    const room = rooms.get(socket.data.code);
    if (!room || room.phase !== 'roundEnd') return;

    room.phase = 'playing';
    const gs = room.gs;
    gs.round++;
    gs.currentPlayer = gs.round % room.players.length;
    gs.flipped = [];
    gs.matched = [];
    gs.locked = false;
    const topicId = pickTopicId(room.settings);
    gs.topicId = topicId;
    gs.cards = buildCards(room.settings.numPairs);

    io.to(room.code).emit('roundStarted', {
      cards: gs.cards.map(publicCard),
      topicId,
      currentPlayer: gs.currentPlayer,
      players: room.players,
      round: gs.round,
    });
  });

  // ── Play Again ────────────────────────────────────────────────────────────
  socket.on('playAgain', () => {
    const room = rooms.get(socket.data.code);
    if (!room || room.phase !== 'ended') return;
    beginGame(room, true);
  });

  // ── Disconnect ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const code = socket.data.code;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    room.players = room.players.filter(p => p.id !== socket.id);

    if (room.players.length === 0) {
      rooms.delete(code);
      return;
    }

    // Reassign host if host left
    if (room.hostId === socket.id) {
      room.hostId = room.players[0].id;
    }
    // Reassign colors after player removed
    room.players.forEach((p, i) => { p.color = PLAYER_COLORS[i]; });

    // Clamp currentPlayer index
    if (room.gs && room.gs.currentPlayer >= room.players.length) {
      room.gs.currentPlayer = 0;
    }

    io.to(code).emit('playerLeft', {
      players: room.players,
      newHostId: room.hostId,
    });
  });
});

const PORT = process.env.PORT || 3002;
httpServer.listen(PORT, () => console.log(`Memory Game server on port ${PORT}`));
