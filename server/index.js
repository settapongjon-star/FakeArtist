const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // allow all in dev
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3001;

// Stores all rooms and their states
const rooms = {};

// distinct colors for players
const playerColors = [
  '#ef4444', '#3b82f6', '#22c55e', '#eab308', 
  '#a855f7', '#f97316', '#ec4899', '#14b8a6', 
  '#6366f1', '#8b5cf6'
];

function createInitialRoomState(roomId) {
  return {
    id: roomId,
    players: [], // { id, name, role, order, isReady, color }
    state: 'lobby', // lobby, role_reveal, drawing, voting, result
    questionMaster: null,
    fakeArtist: null,
    category: '',
    word: '',
    currentTurnIndex: 0,
    round: 1,
    maxRounds: 2,
    lines: [],
    votes: {},
    result: null
  };
}

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Create Room
  socket.on('create_room', (playerName, callback) => {
    const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
    rooms[roomId] = createInitialRoomState(roomId);
    
    joinRoom(socket, roomId, playerName);
    callback({ success: true, roomId });
  });

  // Join Room
  socket.on('join_room', ({ roomId, playerName }, callback) => {
    roomId = roomId.toUpperCase();
    if (!rooms[roomId]) {
      return callback({ success: false, message: 'Room not found' });
    }
    if (rooms[roomId].state !== 'lobby') {
       return callback({ success: false, message: 'Game already started' });
    }
    if (rooms[roomId].players.length >= 10) {
      return callback({ success: false, message: 'Room is full' });
    }
    
    joinRoom(socket, roomId, playerName);
    callback({ success: true, roomId });
  });

  function joinRoom(socket, roomId, playerName) {
    socket.join(roomId);
    socket.roomId = roomId;

    const room = rooms[roomId];
    const color = playerColors[room.players.length % playerColors.length];
    
    const player = {
      id: socket.id,
      name: playerName,
      role: null, // 'question_master', 'fake_artist', 'real_artist'
      order: 0,
      isReady: false,
      color: color
    };

    room.players.push(player);
    io.to(roomId).emit('room_update', room);
  }

  // Ready State
  socket.on('toggle_ready', () => {
    const roomId = socket.roomId;
    if (roomId && rooms[roomId]) {
      const room = rooms[roomId];
      const player = room.players.find(p => p.id === socket.id);
      if (player) {
        player.isReady = !player.isReady;
        io.to(roomId).emit('room_update', room);
      }
    }
  });

  // Start Game
  socket.on('start_game', () => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;

    const room = rooms[roomId];
    if (room.players.length < 3) return; // Need at least 3 players (1 QM, 1 FA, 1 RA)
    
    // Assign Roles
    const shuffledPlayers = [...room.players].sort(() => 0.5 - Math.random());
    room.questionMaster = shuffledPlayers[0].id;
    room.fakeArtist = shuffledPlayers[1].id;
    
    shuffledPlayers[0].role = 'question_master';
    shuffledPlayers[1].role = 'fake_artist';
    
    for (let i = 2; i < shuffledPlayers.length; i++) {
      shuffledPlayers[i].role = 'real_artist';
    }

    // Set play order (excluding QM)
    const artists = room.players.filter(p => p.role !== 'question_master');
    const shuffledArtists = [...artists].sort(() => 0.5 - Math.random());
    shuffledArtists.forEach((p, idx) => {
      p.order = idx;
    });

    room.state = 'role_reveal';
    io.to(roomId).emit('room_update', room);
  });

  // QM sets word
  socket.on('set_word', ({ category, word }) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];

    if (socket.id !== room.questionMaster) return;

    room.category = category;
    room.word = word;
    room.state = 'drawing';
    room.currentTurnIndex = 0;
    room.round = 1;
    room.lines = [];

    io.to(roomId).emit('room_update', room);
  });

  // Drawing Events
  socket.on('draw_line', (lineData) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    
    const room = rooms[roomId];
    
    // Check if it's player's turn
    const artists = room.players.filter(p => p.role !== 'question_master').sort((a, b) => a.order - b.order);
    const currentArtist = artists[room.currentTurnIndex];
    
    if (currentArtist && currentArtist.id === socket.id) {
      // Add line to room state
      room.lines.push(lineData);
      // Broadcast to everyone else
      socket.to(roomId).emit('draw_line', lineData);
    }
  });

  // Next Turn / Finished drawing a stroke
  socket.on('end_turn', () => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;

    const room = rooms[roomId];
    const artists = room.players.filter(p => p.role !== 'question_master');
    
    room.currentTurnIndex++;
    
    if (room.currentTurnIndex >= artists.length) {
      room.currentTurnIndex = 0;
      room.round++;
    }

    if (room.round > room.maxRounds) {
      room.state = 'voting';
    }

    io.to(roomId).emit('room_update', room);
  });

  // Voting
  socket.on('submit_vote', (votedForId) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;

    const room = rooms[roomId];
    room.votes[socket.id] = votedForId;

    // Check if everyone (except QM) has voted
    const artists = room.players.filter(p => p.role !== 'question_master');
    if (Object.keys(room.votes).length >= artists.length) {
      // Calculate votes
      let voteCounts = {};
      Object.values(room.votes).forEach(id => {
        voteCounts[id] = (voteCounts[id] || 0) + 1;
      });

      // Find max votes
      let maxVotes = 0;
      let mostVotedPlayers = [];
      for (const [id, count] of Object.entries(voteCounts)) {
        if (count > maxVotes) {
          maxVotes = count;
          mostVotedPlayers = [id];
        } else if (count === maxVotes) {
          mostVotedPlayers.push(id);
        }
      }

      room.state = 'result';
      room.result = {
        votes: voteCounts,
        mostVoted: mostVotedPlayers,
        fakeArtistCaught: mostVotedPlayers.length === 1 && mostVotedPlayers[0] === room.fakeArtist
      };

      io.to(roomId).emit('room_update', room);
    } else {
      // Just notify someone voted
      io.to(roomId).emit('room_update', room);
    }
  });

  // FA Guesses word
  socket.on('guess_word', (guess) => {
     const roomId = socket.roomId;
     if (!roomId || !rooms[roomId]) return;
     const room = rooms[roomId];

     if (socket.id !== room.fakeArtist) return;

     const isCorrect = guess.toLowerCase().trim() === room.word.toLowerCase().trim();
     room.result.guess = guess;
     room.result.guessCorrect = isCorrect;
     room.result.finalWinner = isCorrect ? 'fake_artist' : 'real_artists';

     io.to(roomId).emit('room_update', room);
  });

  // Restart Game
  socket.on('restart_game', () => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    
    const room = rooms[roomId];
    room.state = 'lobby';
    room.questionMaster = null;
    room.fakeArtist = null;
    room.category = '';
    room.word = '';
    room.lines = [];
    room.votes = {};
    room.result = null;
    room.currentTurnIndex = 0;
    room.round = 1;
    room.players.forEach(p => {
      p.isReady = false;
      p.role = null;
    });

    io.to(roomId).emit('room_update', room);
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    const roomId = socket.roomId;
    if (roomId && rooms[roomId]) {
      const room = rooms[roomId];
      room.players = room.players.filter(p => p.id !== socket.id);
      
      if (room.players.length === 0) {
        delete rooms[roomId];
      } else {
        io.to(roomId).emit('room_update', room);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
