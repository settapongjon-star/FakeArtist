import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import './App.css';

const BACKEND_URL = window.location.hostname === 'localhost' ? 'http://localhost:3001' : window.location.origin;
const socket = io(BACKEND_URL);

export default function App() {
  const [gameState, setGameState] = useState(null);
  const [playerName, setPlayerName] = useState('');
  const [roomIdInput, setRoomIdInput] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    socket.on('room_update', (room) => {
      setGameState(room);
      setError('');
    });

    return () => {
      socket.off('room_update');
    };
  }, []);

  const handleCreateRoom = () => {
    if (!playerName) return setError('Please enter your name');
    socket.emit('create_room', playerName, (res) => {
      if (!res.success) setError(res.message);
    });
  };

  const handleJoinRoom = () => {
    if (!playerName) return setError('Please enter your name');
    if (!roomIdInput) return setError('Please enter a room code');
    socket.emit('join_room', { roomId: roomIdInput, playerName }, (res) => {
      if (!res.success) setError(res.message);
    });
  };

  if (!gameState) {
    return (
      <div className="app-container">
        <h1 className="title">Fake Artist</h1>
        <p className="subtitle">Goes to New York</p>
        
        <div className="lobby-container">
          <input 
            type="text" 
            placeholder="Your Name" 
            value={playerName} 
            onChange={e => setPlayerName(e.target.value)} 
          />
          {error && <p style={{color: 'var(--primary)', margin: '10px 0'}}>{error}</p>}
          <button onClick={handleCreateRoom}>Create Room</button>
          
          <div style={{margin: '20px 0', width: '100%', textAlign: 'center'}}>OR</div>
          
          <input 
            type="text" 
            placeholder="Room Code (e.g. A4X9)" 
            value={roomIdInput} 
            onChange={e => setRoomIdInput(e.target.value)}
            style={{textTransform: 'uppercase'}}
          />
          <button className="secondary" onClick={handleJoinRoom}>Join Room</button>
        </div>
      </div>
    );
  }

  const me = gameState.players.find(p => p.id === socket.id);
  const isQuestionMaster = me?.role === 'question_master';
  const isFakeArtist = me?.role === 'fake_artist';

  const renderState = () => {
    switch (gameState.state) {
      case 'lobby':
        return <LobbyState gameState={gameState} me={me} />;
      case 'role_reveal':
        return <RoleRevealState gameState={gameState} me={me} />;
      case 'drawing':
        return <DrawingState gameState={gameState} me={me} />;
      case 'voting':
        return <VotingState gameState={gameState} me={me} />;
      case 'result':
        return <ResultState gameState={gameState} me={me} />;
      default:
        return <div>Unknown state</div>;
    }
  };

  return (
    <div className="app-container">
      {renderState()}
    </div>
  );
}

function LobbyState({ gameState, me }) {
  return (
    <div className="lobby-container">
      <h2 className="title">Room Lobby</h2>
      <div className="room-info">Room Code: {gameState.id}</div>
      
      <h3>Players ({gameState.players.length}/10)</h3>
      <div className="player-list">
        {gameState.players.map(p => (
          <div key={p.id} className="player-badge">
            <div className="color-dot" style={{backgroundColor: p.color}}></div>
            {p.name} {p.id === me.id ? '(You)' : ''} {p.isReady ? '✅' : '⏳'}
          </div>
        ))}
      </div>

      <button onClick={() => socket.emit('toggle_ready')}>
        {me.isReady ? 'Not Ready' : 'Ready'}
      </button>
      
      {gameState.players.length >= 3 && gameState.players.every(p => p.isReady) ? (
        <button className="secondary" onClick={() => socket.emit('start_game')}>
          Start Game
        </button>
      ) : (
        <p style={{marginTop: '20px', color: 'var(--text-muted)'}}>
          Need at least 3 players. Everyone must be ready to start.
        </p>
      )}
    </div>
  );
}

function RoleRevealState({ gameState, me }) {
  const [category, setCategory] = useState('');
  const [word, setWord] = useState('');

  const handleSubmitWord = () => {
    if (category && word) {
      socket.emit('set_word', { category, word });
    }
  };

  return (
    <div className="role-container">
      <h2 className="title">Your Role</h2>
      
      <div className="role-card">
        {me.role === 'question_master' && (
          <>
            <h3 className="role-title">Question Master</h3>
            <p>You choose the category and the word.</p>
            <input placeholder="Category (e.g. Animal)" value={category} onChange={e=>setCategory(e.target.value)} />
            <input placeholder="Word (e.g. Dog)" value={word} onChange={e=>setWord(e.target.value)} />
            <button onClick={handleSubmitWord}>Start Drawing</button>
          </>
        )}
        
        {me.role === 'fake_artist' && (
          <>
            <h3 className="role-title">Fake Artist</h3>
            <p>You don't know the word! Try to blend in.</p>
            <p style={{marginTop: '20px', color: 'var(--text-muted)'}}>Waiting for Question Master to choose...</p>
          </>
        )}
        
        {me.role === 'real_artist' && (
          <>
            <h3 className="role-title">Real Artist</h3>
            <p>You know the word! Draw it, but don't make it too obvious so the Fake Artist doesn't guess it.</p>
            <p style={{marginTop: '20px', color: 'var(--text-muted)'}}>Waiting for Question Master to choose...</p>
          </>
        )}
      </div>
    </div>
  );
}

function DrawingState({ gameState, me }) {
  const canvasRef = useRef(null);
  const isDrawing = useRef(false);
  const currentPath = useRef([]);
  
  const artists = gameState.players.filter(p => p.role !== 'question_master').sort((a, b) => a.order - b.order);
  const currentArtist = artists[gameState.currentTurnIndex];
  const isMyTurn = currentArtist?.id === me.id;

  useEffect(() => {
    // Redraw all lines when game state updates
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    gameState.lines.forEach(line => {
      if (line.points.length < 2) return;
      ctx.beginPath();
      ctx.strokeStyle = line.color;
      ctx.moveTo(line.points[0].x, line.points[0].y);
      for (let i = 1; i < line.points.length; i++) {
        ctx.lineTo(line.points[i].x, line.points[i].y);
      }
      ctx.stroke();
    });
  }, [gameState.lines]);

  // Real-time drawing from others
  useEffect(() => {
    const handleDrawLine = (line) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 4;
      
      if (line.points.length < 2) return;
      ctx.beginPath();
      ctx.strokeStyle = line.color;
      ctx.moveTo(line.points[0].x, line.points[0].y);
      for (let i = 1; i < line.points.length; i++) {
        ctx.lineTo(line.points[i].x, line.points[i].y);
      }
      ctx.stroke();
    };

    socket.on('draw_line', handleDrawLine);
    return () => socket.off('draw_line', handleDrawLine);
  }, []);

  const getCoordinates = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    let clientX = e.clientX;
    let clientY = e.clientY;
    
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    }
    
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  };

  const startDrawing = (e) => {
    if (!isMyTurn) return;
    isDrawing.current = true;
    const coords = getCoordinates(e);
    currentPath.current = [coords];
  };

  const draw = (e) => {
    if (!isDrawing.current || !isMyTurn) return;
    e.preventDefault(); // Prevent scrolling on touch
    
    const coords = getCoordinates(e);
    currentPath.current.push(coords);
    
    // Draw locally immediately
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = me.color;
    
    ctx.beginPath();
    const lastPoint = currentPath.current[currentPath.current.length - 2];
    ctx.moveTo(lastPoint.x, lastPoint.y);
    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();
  };

  const endDrawing = () => {
    if (!isDrawing.current || !isMyTurn) return;
    isDrawing.current = false;
    
    // Send stroke to server
    socket.emit('draw_line', {
      color: me.color,
      points: currentPath.current
    });
    
    // End turn automatically after one stroke
    socket.emit('end_turn');
  };

  return (
    <div className="drawing-container">
      <div className={`turn-indicator ${isMyTurn ? 'my-turn' : ''}`}>
        {isMyTurn ? "It's your turn! Draw ONE stroke." : `Waiting for ${currentArtist?.name} to draw...`}
      </div>
      
      <div style={{display: 'flex', justifyContent: 'space-between', width: '100%', marginBottom: '10px'}}>
        <div><strong>Category:</strong> {gameState.category}</div>
        <div>
           {me.role !== 'fake_artist' ? (
             <span><strong>Word:</strong> {gameState.word}</span>
           ) : (
             <span style={{color: 'var(--primary)'}}>You are the Fake Artist!</span>
           )}
        </div>
      </div>
      
      <div>Round: {gameState.round} / {gameState.maxRounds}</div>

      <div className="canvas-wrapper">
        <canvas
          ref={canvasRef}
          width={800}
          height={500}
          style={{ width: '100%', maxWidth: '800px', height: 'auto', display: 'block', cursor: isMyTurn ? 'crosshair' : 'not-allowed' }}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={endDrawing}
          onMouseOut={endDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={endDrawing}
        />
      </div>

      <div className="player-list">
        {artists.map((p, idx) => (
          <div key={p.id} className="player-badge" style={{ opacity: gameState.currentTurnIndex === idx ? 1 : 0.5 }}>
            <div className="color-dot" style={{backgroundColor: p.color}}></div>
            {p.name}
          </div>
        ))}
      </div>
    </div>
  );
}

function VotingState({ gameState, me }) {
  const [selected, setSelected] = useState(null);
  
  const artists = gameState.players.filter(p => p.role !== 'question_master');
  const hasVoted = gameState.votes[me.id];

  const handleVote = () => {
    if (selected) {
      socket.emit('submit_vote', selected);
    }
  };

  if (me.role === 'question_master') {
    return (
      <div className="voting-container">
        <h2 className="title">Voting Phase</h2>
        <p>Artists are voting for who they think the Fake Artist is...</p>
      </div>
    );
  }

  return (
    <div className="voting-container">
      <h2 className="title">Who is the Fake Artist?</h2>
      
      {hasVoted ? (
        <p>Waiting for others to vote...</p>
      ) : (
        <>
          <div className="voting-grid">
            {artists.map(p => {
              if (p.id === me.id) return null; // Can't vote for self
              return (
                <div 
                  key={p.id} 
                  className={`vote-card ${selected === p.id ? 'selected' : ''}`}
                  onClick={() => setSelected(p.id)}
                >
                  <div className="color-dot" style={{backgroundColor: p.color, margin: '0 auto 10px'}}></div>
                  <h3>{p.name}</h3>
                </div>
              );
            })}
          </div>
          
          <button style={{marginTop: '30px'}} onClick={handleVote} disabled={!selected}>
            Submit Vote
          </button>
        </>
      )}
    </div>
  );
}

function ResultState({ gameState, me }) {
  const [guess, setGuess] = useState('');
  
  const { result } = gameState;
  const fakeArtist = gameState.players.find(p => p.id === gameState.fakeArtist);
  const qm = gameState.players.find(p => p.role === 'question_master');

  // If Fake Artist was caught, they get a chance to guess
  if (result.fakeArtistCaught && !result.guess) {
    if (me.role === 'fake_artist') {
      return (
        <div className="result-container">
          <h2 className="title">You were caught!</h2>
          <p>But you can still win if you guess the word!</p>
          <p>Category: {gameState.category}</p>
          <input 
            placeholder="Your guess..." 
            value={guess} 
            onChange={e => setGuess(e.target.value)} 
          />
          <button onClick={() => socket.emit('guess_word', guess)}>Guess</button>
        </div>
      );
    } else {
      return (
        <div className="result-container">
          <h2 className="title">Fake Artist Caught!</h2>
          <p>The Fake Artist ({fakeArtist?.name}) is guessing the word...</p>
        </div>
      );
    }
  }

  // Final Result Screen
  return (
    <div className="result-container">
      <h2 className="title">Game Over!</h2>
      
      <div className="role-card" style={{maxWidth: '600px'}}>
        <h3>The Word was: <span style={{color: 'var(--primary)'}}>{gameState.word}</span></h3>
        <p style={{margin: '10px 0'}}>Question Master: {qm?.name}</p>
        <p style={{margin: '10px 0'}}>Fake Artist: {fakeArtist?.name}</p>
        
        <hr style={{borderColor: 'var(--border)', margin: '20px 0'}} />
        
        {result.fakeArtistCaught ? (
          <>
            <h3 style={{color: '#22c55e'}}>Fake Artist was caught!</h3>
            {result.guess && (
              <p style={{marginTop: '10px'}}>
                Fake Artist guessed: <strong>{result.guess}</strong> <br/>
                {result.guessCorrect ? (
                  <span style={{color: '#ef4444', fontSize: '1.2rem'}}>Fake Artist guessed correctly and WINS!</span>
                ) : (
                  <span style={{color: '#3b82f6', fontSize: '1.2rem'}}>Fake Artist guessed wrong. Real Artists WIN!</span>
                )}
              </p>
            )}
          </>
        ) : (
          <h3 style={{color: '#ef4444'}}>Fake Artist escaped! Fake Artist & Question Master WIN!</h3>
        )}
      </div>

      {me.role === 'question_master' && (
        <button onClick={() => socket.emit('restart_game')}>Play Again</button>
      )}
      {me.role !== 'question_master' && (
        <p style={{marginTop: '20px', color: 'var(--text-muted)'}}>Waiting for Question Master to restart...</p>
      )}
    </div>
  );
}
