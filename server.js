const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// ==================== GAME LOGIC ====================
const CARD_VALUES = [2,3,4,5,6,7,8,9,10];
const CARDS_PER_PLAYER = 5;
const WIN_ROUNDS = 5;
const MAX_ROUNDS = 12;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function createDeck() {
  let deck = [];
  CARD_VALUES.forEach(v => { for (let i = 0; i < 3; i++) deck.push(v); });
  return shuffle(deck);
}

function newGameState(roomId, player1Id, player2Id) {
  const deck = createDeck();
  return {
    roomId,
    players: {
      [player1Id]: { hand: deck.slice(0, CARDS_PER_PLAYER).sort((a,b)=>a-b), wins: 0, name: 'Player 1' },
      [player2Id]: { hand: deck.slice(CARDS_PER_PLAYER, CARDS_PER_PLAYER*2).sort((a,b)=>a-b), wins: 0, name: 'Player 2' }
    },
    playerOrder: [player1Id, player2Id],
    deck: deck.slice(CARDS_PER_PLAYER * 2),
    discard: [],
    round: 1,
    phase: 'play', // play → call → resolve
    plays: {},     // { playerId: { card, declaration } }
    callAction: null, // { callerId, called: 'bluff'|'pass' }
    pendingCallFrom: null, // which player gets to call
    log: [],
  };
}

function refillHands(gs) {
  const pids = gs.playerOrder;
  pids.forEach(pid => {
    const hand = gs.players[pid].hand;
    while (hand.length < CARDS_PER_PLAYER) {
      if (gs.deck.length === 0) {
        if (gs.discard.length === 0) break;
        gs.deck = shuffle(gs.discard);
        gs.discard = [];
      }
      hand.push(gs.deck.pop());
    }
    gs.players[pid].hand.sort((a,b)=>a-b);
  });
}

function resolveRound(gs) {
  const [p1, p2] = gs.playerOrder;
  const play1 = gs.plays[p1];
  const play2 = gs.plays[p2];
  const caller = gs.pendingCallFrom;
  const other = caller === p1 ? p2 : p1;

  let result = { winner: null, loser: null, reason: '', bluffRevealed: false };
  const callerPlay  = gs.plays[caller];
  const calledPlay  = gs.plays[other];

  if (gs.callAction === 'bluff') {
    const wasBluff = calledPlay.card !== calledPlay.declaration;
    if (wasBluff) {
      // Caller correct — called player loses their card
      result.winner = caller;
      result.loser  = other;
      result.reason = `${gs.players[caller].name} correctly called bluff! ${gs.players[other].name} played ${calledPlay.card} but declared ${calledPlay.declaration}.`;
      gs.discard.push(calledPlay.card);
      removeCardFromHand(gs, other, calledPlay.card);
      gs.players[caller].wins++;
    } else {
      // Wrong call — caller loses their card
      result.winner = other;
      result.loser  = caller;
      result.reason = `${gs.players[caller].name} called bluff wrongly! ${gs.players[other].name} truly played ${calledPlay.card}.`;
      gs.discard.push(callerPlay.card);
      removeCardFromHand(gs, caller, callerPlay.card);
      gs.players[other].wins++;
    }
    result.bluffRevealed = true;
  } else {
    // No call — compare actual cards
    const c1 = play1.card, c2 = play2.card;
    if (c1 > c2) {
      result.winner = p1;
      result.loser  = p2;
      result.reason = `${gs.players[p1].name}'s ${c1} beats ${gs.players[p2].name}'s ${c2}.`;
      gs.discard.push(c2);
      removeCardFromHand(gs, p2, c2);
      gs.players[p1].wins++;
    } else if (c2 > c1) {
      result.winner = p2;
      result.loser  = p1;
      result.reason = `${gs.players[p2].name}'s ${c2} beats ${gs.players[p1].name}'s ${c1}.`;
      gs.discard.push(c1);
      removeCardFromHand(gs, p1, c1);
      gs.players[p2].wins++;
    } else {
      result.winner = null;
      result.reason = `Tie! Both played ${c1}. Both cards discarded.`;
      gs.discard.push(c1, c2);
      removeCardFromHand(gs, p1, c1);
      removeCardFromHand(gs, p2, c2);
    }
  }
  return result;
}

function removeCardFromHand(gs, pid, cardVal) {
  const hand = gs.players[pid].hand;
  const idx = hand.indexOf(cardVal);
  if (idx !== -1) hand.splice(idx, 1);
}

function checkGameOver(gs) {
  const [p1, p2] = gs.playerOrder;
  const w1 = gs.players[p1].wins;
  const w2 = gs.players[p2].wins;
  if (w1 >= WIN_ROUNDS) return p1;
  if (w2 >= WIN_ROUNDS) return p2;
  if (gs.round >= MAX_ROUNDS) return w1 > w2 ? p1 : w2 > w1 ? p2 : 'draw';
  if (gs.players[p1].hand.length === 0 && gs.players[p2].hand.length === 0) {
    return w1 > w2 ? p1 : w2 > w1 ? p2 : 'draw';
  }
  return null;
}

// ==================== ROOM MANAGEMENT ====================
const rooms = {}; // roomId -> { id, players: [socketId], game, names }
const socketToRoom = {}; // socketId -> roomId
const waitingRoom = { socketId: null }; // single waiting player queue

function createRoom(s1id, s2id) {
  const roomId = uuidv4().slice(0,6).toUpperCase();
  rooms[roomId] = {
    id: roomId,
    players: [s1id, s2id],
    game: newGameState(roomId, s1id, s2id),
    ready: new Set(),
  };
  socketToRoom[s1id] = roomId;
  socketToRoom[s2id] = roomId;
  return rooms[roomId];
}

function getPublicState(gs, forPlayerId) {
  const opp = gs.playerOrder.find(id => id !== forPlayerId);
  return {
    round: gs.round,
    phase: gs.phase,
    myHand: gs.players[forPlayerId].hand,
    myWins: gs.players[forPlayerId].wins,
    myName: gs.players[forPlayerId].name,
    oppWins: gs.players[opp].wins,
    oppName: gs.players[opp].name,
    oppHandCount: gs.players[opp].hand.length,
    deckCount: gs.deck.length,
    discardCount: gs.discard.length,
    myPlayed: gs.plays[forPlayerId] || null,
    oppPlayed: gs.plays[opp] ? { declaration: gs.plays[opp].declaration } : null,
    pendingCallFrom: gs.pendingCallFrom,
    isMyTurnToCall: gs.pendingCallFrom === forPlayerId,
    log: gs.log.slice(-15),
    playerOrder: gs.playerOrder,
    myId: forPlayerId,
  };
}

// ==================== SOCKET EVENTS ====================
io.on('connection', (socket) => {
  console.log(`+ connected: ${socket.id}`);

  socket.on('set_name', (name) => {
    socket._playerName = (name || 'Player').slice(0, 18);
  });

  socket.on('join_queue', () => {
    if (waitingRoom.socketId && waitingRoom.socketId !== socket.id) {
      const s1 = waitingRoom.socketId;
      const s2 = socket.id;
      waitingRoom.socketId = null;

      const room = createRoom(s1, s2);
      const gs = room.game;

      // Assign names
      const s1sock = io.sockets.sockets.get(s1);
      const s2sock = io.sockets.sockets.get(s2);
      gs.players[s1].name = (s1sock && s1sock._playerName) || 'Player 1';
      gs.players[s2].name = (s2sock && s2sock._playerName) || 'Player 2';

      io.sockets.sockets.get(s1)?.join(room.id);
      socket.join(room.id);

      io.to(s1).emit('game_start', getPublicState(gs, s1));
      io.to(s2).emit('game_start', getPublicState(gs, s2));
      console.log(`Room ${room.id}: ${gs.players[s1].name} vs ${gs.players[s2].name}`);
    } else {
      waitingRoom.socketId = socket.id;
      socket.emit('waiting', { msg: 'Waiting for opponent...' });
    }
  });

  socket.on('play_card', ({ cardIndex, declaration }) => {
    const roomId = socketToRoom[socket.id];
    if (!roomId || !rooms[roomId]) return;
    const gs = rooms[roomId].game;
    if (gs.phase !== 'play') return;

    const hand = gs.players[socket.id].hand;
    if (cardIndex < 0 || cardIndex >= hand.length) return;
    const card = hand[cardIndex];
    if (!CARD_VALUES.includes(declaration)) return;

    gs.plays[socket.id] = { card, declaration };

    // Both played?
    if (Object.keys(gs.plays).length === 2) {
      gs.phase = 'call';
      // Randomly pick who gets to call first (or use player1 always)
      gs.pendingCallFrom = gs.playerOrder[0];
      const opp = gs.playerOrder[1];

      // Send state to both
      io.to(gs.playerOrder[0]).emit('state_update', getPublicState(gs, gs.playerOrder[0]));
      io.to(gs.playerOrder[1]).emit('state_update', getPublicState(gs, gs.playerOrder[1]));
    } else {
      // Tell this player their play was received
      socket.emit('play_received');
      // Tell opponent a card was played (without revealing)
      const opp = gs.playerOrder.find(id => id !== socket.id);
      io.to(opp).emit('opp_played');
    }
  });

  socket.on('call_action', ({ action }) => {
    // action: 'bluff' or 'pass'
    const roomId = socketToRoom[socket.id];
    if (!roomId || !rooms[roomId]) return;
    const gs = rooms[roomId].game;
    if (gs.phase !== 'call') return;
    if (gs.pendingCallFrom !== socket.id) return;

    if (action === 'bluff') {
      gs.callAction = 'bluff';
      const result = resolveRound(gs);
      gs.phase = 'resolve';
      const resolveData = {
        result,
        plays: gs.plays,
        scores: {
          [gs.playerOrder[0]]: gs.players[gs.playerOrder[0]].wins,
          [gs.playerOrder[1]]: gs.players[gs.playerOrder[1]].wins,
        }
      };
      gs.log.push({ text: result.reason, type: result.winner ? (result.winner === socket.id ? 'win' : 'loss') : 'neutral' });

      const gameOver = checkGameOver(gs);
      gs.playerOrder.forEach(pid => {
        io.to(pid).emit('round_resolve', {
          ...resolveData,
          myId: pid,
          gameOver,
          winnerId: gameOver && gameOver !== 'draw' ? gameOver : null,
        });
      });
    } else {
      // Pass — if first caller passes, give second player a chance
      const otherPlayer = gs.playerOrder.find(id => id !== socket.id);
      if (gs.pendingCallFrom === gs.playerOrder[0]) {
        // Give p2 a chance to call
        gs.pendingCallFrom = gs.playerOrder[1];
        gs.callAction = 'pending_p2';
        io.to(gs.playerOrder[0]).emit('state_update', getPublicState(gs, gs.playerOrder[0]));
        io.to(gs.playerOrder[1]).emit('state_update', getPublicState(gs, gs.playerOrder[1]));
      } else {
        // Both passed — resolve without call
        gs.callAction = 'none';
        const result = resolveRound(gs);
        gs.phase = 'resolve';
        const resolveData = {
          result,
          plays: gs.plays,
          scores: {
            [gs.playerOrder[0]]: gs.players[gs.playerOrder[0]].wins,
            [gs.playerOrder[1]]: gs.players[gs.playerOrder[1]].wins,
          }
        };
        gs.log.push({ text: result.reason, type: result.winner ? 'neutral' : 'neutral' });

        const gameOver = checkGameOver(gs);
        gs.playerOrder.forEach(pid => {
          io.to(pid).emit('round_resolve', {
            ...resolveData,
            myId: pid,
            gameOver,
            winnerId: gameOver && gameOver !== 'draw' ? gameOver : null,
          });
        });
      }
    }
  });

  socket.on('next_round', () => {
    const roomId = socketToRoom[socket.id];
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    room.ready = room.ready || new Set();
    room.ready.add(socket.id);

    if (room.ready.size === 2) {
      room.ready.clear();
      const gs = room.game;
      gs.round++;
      gs.phase = 'play';
      gs.plays = {};
      gs.callAction = null;
      gs.pendingCallFrom = null;
      refillHands(gs);
      gs.playerOrder.forEach(pid => {
        io.to(pid).emit('state_update', getPublicState(gs, pid));
      });
    } else {
      socket.emit('waiting_next_round');
    }
  });

  socket.on('disconnect', () => {
    console.log(`- disconnected: ${socket.id}`);
    if (waitingRoom.socketId === socket.id) waitingRoom.socketId = null;

    const roomId = socketToRoom[socket.id];
    if (roomId && rooms[roomId]) {
      const opp = rooms[roomId].players.find(id => id !== socket.id);
      if (opp) io.to(opp).emit('opp_disconnected');
      delete rooms[roomId];
    }
    delete socketToRoom[socket.id];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Declare Duel server running on port ${PORT}`));
