const canvas = document.getElementById('poolTable');
const ctx = canvas.getContext('2d');
const roomInput = document.getElementById('room-input');
const hostBtn = document.getElementById('host-btn');
const joinBtn = document.getElementById('join-btn');
const singleBtn = document.getElementById('single-btn');
const connStatus = document.getElementById('conn-status');
const overlay = document.getElementById('overlay');

const WIDTH = 800, HEIGHT = 400, BALL_RADIUS = 10, FRICTION = 0.982, WALL_BOUNCE = 0.6, POCKET_RADIUS = 22;
const STOP_THRESHOLD = 0.15;
canvas.width = WIDTH; canvas.height = HEIGHT;

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSound(type, volume = 1) {
    try {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        if (type === 'hit') {
            osc.type = 'sine'; osc.frequency.setValueAtTime(150, audioCtx.currentTime);
            gain.gain.setValueAtTime(Math.min(volume * 0.3, 0.5), audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
            osc.start(); osc.stop(audioCtx.currentTime + 0.1);
        } else if (type === 'pocket') {
            osc.type = 'triangle'; osc.frequency.setValueAtTime(200, audioCtx.currentTime);
            gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
            gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.4);
            osc.start(); osc.stop(audioCtx.currentTime + 0.4);
        }
    } catch(e) {}
}

let balls = [];
let myScore = 0, oppScore = 0;
let isMyTurn = false, gameActive = false, peer, conn, isHost = false, lastShotPocketed = false, statusMessage = "Waiting...";
let isSinglePlayer = false, shotsLeft = 10, highScore = localStorage.getItem('poolHighScore') || 0, waitingForRestart = false;

const pockets = [
    {x: 0, y: 0}, {x: WIDTH/2, y: 0}, {x: WIDTH, y: 0},
    {x: 0, y: HEIGHT}, {x: WIDTH/2, y: HEIGHT}, {x: WIDTH, y: HEIGHT}
];

class Ball {
    constructor(x, y, number, color, isStriped = false) {
        this.x = x; this.y = y; this.number = number; this.color = color;
        this.isStriped = isStriped; this.vx = 0; this.vy = 0; this.inPocket = false;
    }
    draw() {
        if (this.inPocket) return;
        ctx.beginPath(); ctx.arc(this.x, this.y, BALL_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = this.color; ctx.fill();
        if (this.isStriped) {
            ctx.save(); ctx.clip(); ctx.fillStyle = 'white';
            ctx.fillRect(this.x - BALL_RADIUS, this.y - BALL_RADIUS/2, BALL_RADIUS * 2, BALL_RADIUS); ctx.restore();
        }
        if (this.number !== 0) {
            ctx.beginPath(); ctx.arc(this.x, this.y, BALL_RADIUS * 0.5, 0, Math.PI * 2);
            ctx.fillStyle = 'white'; ctx.fill();
            ctx.fillStyle = 'black'; ctx.font = 'bold 8px Arial'; ctx.textAlign = 'center';
            ctx.fillText(this.number, this.x, this.y + 3);
        }
    }
    update() {
        if (this.inPocket) return;
        this.x += this.vx; this.y += this.vy;
        this.vx *= FRICTION; this.vy *= FRICTION;
        if (Math.abs(this.vx) < STOP_THRESHOLD) this.vx = 0;
        if (Math.abs(this.vy) < STOP_THRESHOLD) this.vy = 0;
        
        if (this.x - BALL_RADIUS < 0 || this.x + BALL_RADIUS > WIDTH) {
            this.vx = -this.vx * WALL_BOUNCE; 
            this.x = this.x < BALL_RADIUS ? BALL_RADIUS : WIDTH - BALL_RADIUS;
        }
        if (this.y - BALL_RADIUS < 0 || this.y + BALL_RADIUS > HEIGHT) {
            this.vy = -this.vy * WALL_BOUNCE;
            this.y = this.y < BALL_RADIUS ? BALL_RADIUS : HEIGHT - BALL_RADIUS;
        }
    }
}

function initBalls() {
    balls = [new Ball(WIDTH * 0.25, HEIGHT / 2, 0, 'white')];
    const startX = WIDTH * 0.65, startY = HEIGHT / 2;
    const palette = ['#f1c40f', '#2980b9', '#e74c3c', '#8e44ad', '#e67e22', '#2ecc71', '#c0392b', '#2c3e50'];
    let ballIdx = 0;
    for (let col = 0; col < 5; col++) {
        for (let row = 0; row <= col; row++) {
            const x = startX + col * (BALL_RADIUS * 2); const y = startY + (row - col / 2) * (BALL_RADIUS * 2.1);
            const num = ballIdx + 1;
            balls.push(new Ball(x, y, num, palette[num % 8], num > 8));
            ballIdx++;
        }
    }
}

function setupPeer(id, asHost) {
    isHost = asHost;
    peer = asHost ? new Peer('aisurf-pool-' + id) : new Peer();
    peer.on('open', () => {
        if (asHost) connStatus.textContent = "Room created! Waiting...";
        else { conn = peer.connect('aisurf-pool-' + id); setupConnection(); }
    });
    peer.on('connection', (c) => { if (asHost) { conn = c; setupConnection(); } });
    peer.on('error', (err) => { console.error(err); alert("Connection error. Try a different code."); location.reload(); });
}

function setupConnection() {
    conn.on('open', () => {
        overlay.style.display = 'none'; gameActive = true; initBalls();
        isMyTurn = isHost; statusMessage = isMyTurn ? "Your turn" : "Opponent's turn";
    });
    conn.on('data', (data) => {
        if (data.type === 'SHOT') {
            balls[0].vx = data.vx; balls[0].vy = data.vy; 
            statusMessage = "Shooting..."; 
            lastShotPocketed = false;
            playSound('hit', 1);
        } else if (data.type === 'SYNC') {
            data.balls.forEach((b, i) => {
                balls[i].x = b.x; balls[i].y = b.y; balls[i].inPocket = b.inPocket;
                balls[i].vx = 0; balls[i].vy = 0;
            });
            oppScore = data.myScore; myScore = data.oppScore;
            isMyTurn = data.nextTurnIsMe; 
            statusMessage = isMyTurn ? "Your turn" : "Opponent's turn";
        }
    });
}

function startSinglePlayer() {
    audioCtx.resume();
    overlay.style.display = 'none';
    gameActive = true; isSinglePlayer = true; isMyTurn = true; shotsLeft = 10; myScore = 0; waitingForRestart = false;
    initBalls();
    statusMessage = "Your turn - Shots: " + shotsLeft;
}

let isDragging = false, dragStartX, dragStartY, currentX, currentY;

canvas.addEventListener('pointerdown', (e) => {
    if (waitingForRestart) { startSinglePlayer(); return; }
    if (!isMyTurn || !gameActive || balls.some(b => b.vx !== 0 || b.vy !== 0)) return;
    const rect = canvas.getBoundingClientRect();
    dragStartX = (e.clientX - rect.left) * (WIDTH / rect.width);
    dragStartY = (e.clientY - rect.top) * (HEIGHT / rect.height);
    currentX = dragStartX; currentY = dragStartY;
    isDragging = true;
    canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    const rect = canvas.getBoundingClientRect();
    currentX = (e.clientX - rect.left) * (WIDTH / rect.width);
    currentY = (e.clientY - rect.top) * (HEIGHT / rect.height);
});

canvas.addEventListener('pointerup', (e) => {
    if (!isDragging) return;
    isDragging = false;
    const dx = dragStartX - currentX, dy = dragStartY - currentY;
    const dist = Math.hypot(dx, dy);
    if (dist > 15) {
        const power = Math.min(dist * 0.25, 40);
        const angle = Math.atan2(dy, dx);
        const vx = Math.cos(angle) * power, vy = Math.sin(angle) * power;
        balls[0].vx = vx; balls[0].vy = vy;
        lastShotPocketed = false;
        if (isSinglePlayer) {
            shotsLeft--; isMyTurn = false; statusMessage = "Shooting...";
        } else {
            conn.send({ type: 'SHOT', vx, vy });
            statusMessage = "Shooting...";
        }
        playSound('hit', power/10);
    }
});

function gameLoop() {
    ctx.fillStyle = '#0a5c36'; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.strokeStyle = '#3e2723'; ctx.lineWidth = 12; ctx.strokeRect(0,0,WIDTH,HEIGHT);
    ctx.fillStyle = '#111';
    pockets.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, POCKET_RADIUS, 0, Math.PI * 2); ctx.fill(); });

    let moving = false;
    for (let i = 0; i < balls.length; i++) {
        if (balls[i].inPocket) continue;
        for (let j = i + 1; j < balls.length; j++) {
            if (balls[j].inPocket) continue;
            const dx = balls[j].x - balls[i].x, dy = balls[j].y - balls[i].y;
            const dist = Math.hypot(dx, dy);
            if (dist < BALL_RADIUS * 2) {
                const angle = Math.atan2(dy, dx), sin = Math.sin(angle), cos = Math.cos(angle);
                const vx1 = balls[i].vx * cos + balls[i].vy * sin, vx2 = balls[j].vx * cos + balls[j].vy * sin;
                balls[i].vx = vx2 * cos - (balls[i].vy * cos - balls[i].vx * sin) * sin;
                balls[i].vy = (balls[i].vy * cos - balls[i].vx * sin) * cos + vx2 * sin;
                balls[j].vx = vx1 * cos - (balls[j].vy * cos - balls[j].vx * sin) * sin;
                balls[j].vy = (balls[j].vy * cos - balls[j].vx * sin) * cos + vx1 * sin;
                const overlap = (BALL_RADIUS * 2 - dist) + 0.1;
                balls[i].x -= (overlap/2) * cos; balls[i].y -= (overlap/2) * sin;
                balls[j].x += (overlap/2) * cos; balls[j].y += (overlap/2) * sin;
                if (Math.abs(vx1-vx2) > 1) playSound('hit', Math.abs(vx1-vx2)/15);
            }
        }
        balls[i].update(); balls[i].draw();
        if (Math.abs(balls[i].vx) > 0 || Math.abs(balls[i].vy) > 0) moving = true;
    }

    balls.forEach((ball, idx) => {
        if (ball.inPocket) return;
        pockets.forEach(p => {
            if (Math.hypot(ball.x - p.x, ball.y - p.y) < POCKET_RADIUS) {
                ball.inPocket = true; ball.vx = 0; ball.vy = 0; playSound('pocket');
                if (idx === 0) {
                    lastShotPocketed = false;
                    setTimeout(() => { ball.x = WIDTH * 0.25; ball.y = HEIGHT/2; ball.inPocket = false; }, 1000);
                } else if (isMyTurn || isSinglePlayer) {
                    myScore++; lastShotPocketed = true;
                }
            }
        });
    });

    if (gameActive && !moving && statusMessage === "Shooting...") {
        if (isSinglePlayer) {
            if (shotsLeft === 0 && !balls.some(b => b.vx !== 0 || b.vy !== 0)) {
                if (myScore > highScore) { highScore = myScore; localStorage.setItem('poolHighScore', highScore); }
                statusMessage = "Game Over! Score: " + myScore + ". Click to restart";
                waitingForRestart = true; isMyTurn = false;
            } else {
                isMyTurn = true; statusMessage = "Your turn - Shots: " + shotsLeft;
            }
        } else if (isMyTurn) {
            if (!lastShotPocketed) isMyTurn = false;
            statusMessage = isMyTurn ? "Your turn" : "Opponent's turn";
            if (conn && conn.open) {
                conn.send({ 
                    type: 'SYNC', 
                    balls: balls.map(b => ({x: b.x, y: b.y, inPocket: b.inPocket})), 
                    myScore, oppScore, nextTurnIsMe: !isMyTurn 
                });
            }
        }
    }

    if (isDragging && isMyTurn) {
        const dx = dragStartX - currentX, dy = dragStartY - currentY;
        const angle = Math.atan2(dy, dx);
        ctx.save(); ctx.translate(balls[0].x, balls[0].y); ctx.rotate(angle);
        ctx.fillStyle = '#5d4037'; ctx.fillRect(20, -3, 180, 6); ctx.restore();
        ctx.beginPath(); ctx.setLineDash([5, 5]); ctx.moveTo(balls[0].x, balls[0].y);
        ctx.lineTo(balls[0].x - Math.cos(angle)*100, balls[0].y - Math.sin(angle)*100);
        ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.stroke(); ctx.setLineDash([]);
    }

    ctx.fillStyle = 'white'; ctx.font = 'bold 16px Arial'; ctx.textAlign = 'center';
    if (isSinglePlayer) ctx.fillText(`SCORE: ${myScore}  -  HIGH: ${highScore}  -  SHOTS: ${shotsLeft}`, WIDTH/2, 25);
    else ctx.fillText(`YOU: ${myScore}  -  OPP: ${oppScore}`, WIDTH/2, 25);
    ctx.font = 'italic 14px Arial'; ctx.fillText(statusMessage.toUpperCase(), WIDTH/2, 45);

    requestAnimationFrame(gameLoop);
}

hostBtn.addEventListener('click', () => {
    audioCtx.resume(); const code = roomInput.value.trim();
    if (code.length >= 4) setupPeer(code, true); else alert("Code too short");
});

joinBtn.addEventListener('click', () => {
    audioCtx.resume(); const code = roomInput.value.trim();
    if (code.length >= 4) setupPeer(code, false); else alert("Code too short");
});

singleBtn.addEventListener('click', startSinglePlayer);
gameLoop();