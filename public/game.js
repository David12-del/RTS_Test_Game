// =============================================
// SURVIVAL GAME - CLIENT.JS
// =============================================

const socket = io();

// =============================================
// GAME STATE
// =============================================

const gameState = {
    playerId: null,
    mapWidth: 2000,
    mapHeight: 2000,
    players: {},
    buildings: [],
    monsters: [],
    bullets: [],
    resourcePoints: [],
    myPlayer: null,
    lastServerUpdate: 0,
    renderTime: 0
};

const smoothPlayers = {};
const smoothMonsters = {};
const smoothBuildings = {};

const keys = {
    w: false,
    a: false,
    s: false,
    d: false
};

let selectedBuild = null;
let mouseX = 0;
let mouseY = 0;
let camera = { x: 0, y: 0 };

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const minimap = document.getElementById('minimap');
const minimapCtx = minimap.getContext('2d');

// =============================================
// INITIALIZATION
// =============================================

function init() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    document.getElementById('join-btn').addEventListener('click', joinGame);
    document.getElementById('nickname-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') joinGame();
    });
    document.getElementById('respawn-btn').addEventListener('click', respawn);

    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    });
}

function joinGame() {
    const nickname = document.getElementById('nickname-input').value.trim();
    if (!nickname) return;

    socket.emit('join', nickname);
}

function respawn() {
    document.getElementById('death-screen').style.display = 'none';
    socket.emit('join', document.getElementById('nickname-input').value.trim());
}

// =============================================
// SOCKET EVENTS
// =============================================

socket.on('init', (data) => {
    gameState.playerId = data.id;
    gameState.mapWidth = data.mapWidth;
    gameState.mapHeight = data.mapHeight;
    gameState.resourcePoints = data.resourcePoints;

    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('game-container').style.display = 'block';
});

socket.on('playerJoined', (player) => {
    gameState.players[player.id] = player;
});

socket.on('playerLeft', (id) => {
    delete gameState.players[id];
});

socket.on('playerRespawned', (id) => {
    if (id === gameState.playerId) {
        gameState.myPlayer.hp = gameState.myPlayer.maxHp;
        gameState.myPlayer.x = Math.random() * gameState.mapWidth;
        gameState.myPlayer.y = Math.random() * gameState.mapHeight;
        document.getElementById('death-screen').style.display = 'none';
    }
});

socket.on('buildingCreated', (building) => {
    gameState.buildings.push(building);
});

socket.on('buildingRemoved', (id) => {
    gameState.buildings = gameState.buildings.filter(b => b.id !== id);
});

socket.on('monsterCreated', (monster) => {
    gameState.monsters.push(monster);
});

socket.on('monsterRemoved', (id) => {
    gameState.monsters = gameState.monsters.filter(m => m.id !== id);
});

socket.on('bulletCreated', (bullet) => {
    gameState.bullets.push(bullet);
});

socket.on('bulletRemoved', (id) => {
    gameState.bullets = gameState.bullets.filter(b => b.id !== id);
});

socket.on('waveStart', (data) => {
    showWaveNotification(data.wave);
});

socket.on('timer', (data) => {
    updateTimer(data.nextWaveTime);
});

socket.on('gameState', (state) => {
    gameState.players = state.players;
    gameState.buildings = state.buildings;
    gameState.monsters = state.monsters;
    gameState.bullets = state.bullets;
    gameState.wave = state.wave;
    gameState.nextWaveTime = state.nextWaveTime;
    gameState.lastServerUpdate = performance.now();
});

socket.on('resourceGenerated', (data) => {
});

socket.on('error', (msg) => {
    showNotification(msg, '#ff4444');
});

socket.on('buildError', (msg) => {
    showNotification(msg, '#ff8844');
});

function showNotification(msg, color = '#fff') {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        bottom: 100px;
        left: 50%;
        transform: translateX(-50%);
        font-size: 18px;
        color: ${color};
        font-weight: bold;
        z-index: 200;
        animation: fadeOut 2s forwards;
    `;
    notification.textContent = msg;
    document.body.appendChild(notification);

    setTimeout(() => notification.remove(), 2000);
}

function showWaveNotification(wave) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 48px;
        color: #e94560;
        font-weight: bold;
        text-shadow: 0 0 20px rgba(233, 69, 96, 0.8);
        z-index: 200;
        animation: fadeOut 3s forwards;
    `;
    notification.textContent = `WAVE ${wave}`;
    document.body.appendChild(notification);

    setTimeout(() => notification.remove(), 3000);
}

function updateTimer(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    document.getElementById('wave-timer-val').textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    document.getElementById('wave-num').textContent = gameState.wave || 0;
}

// =============================================
// INPUT HANDLING
// =============================================

document.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (keys.hasOwnProperty(key)) keys[key] = true;

    if (key === '1') selectedBuild = 'wall';
    if (key === '2') selectedBuild = 'turret';
    if (key === '3') selectedBuild = 'dril';
    if (key === '4') selectedBuild = 'mine';

    updateBuildMenu();
});

document.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if (keys.hasOwnProperty(key)) keys[key] = false;
});

canvas.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
});

canvas.addEventListener('click', (e) => {
    if (!gameState.myPlayer || !selectedBuild) return;

    const worldX = mouseX + camera.x;
    const worldY = mouseY + camera.y;

    socket.emit('build', {
        type: selectedBuild,
        x: worldX,
        y: worldY
    });
});

canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();

    if (!gameState.myPlayer) return;

    const angle = Math.atan2(mouseY + camera.y - gameState.myPlayer.y, mouseX + camera.x - gameState.myPlayer.x);
    socket.emit('shoot', { angle });
});

function updateBuildMenu() {
    document.querySelectorAll('.build-option').forEach(el => {
        el.classList.remove('active');
        if (el.dataset.type === selectedBuild) {
            el.classList.add('active');
        }
    });
}

// =============================================
// GAME LOOP
// =============================================

function update() {
    if (!gameState.playerId || !gameState.players[gameState.playerId]) return;

    gameState.myPlayer = gameState.players[gameState.playerId];

    if (gameState.myPlayer.hp <= 0) {
        document.getElementById('death-screen').style.display = 'flex';
    }

    const player = gameState.myPlayer;
    let dx = 0;
    let dy = 0;

    if (keys.w) dy -= player.speed;
    if (keys.s) dy += player.speed;
    if (keys.a) dx -= player.speed;
    if (keys.d) dx += player.speed;

    if (dx !== 0 || dy !== 0) {
        const len = Math.sqrt(dx * dx + dy * dy);
        dx = (dx / len) * player.speed;
        dy = (dy / len) * player.speed;

        player.x = Math.max(0, Math.min(gameState.mapWidth, player.x + dx));
        player.y = Math.max(0, Math.min(gameState.mapHeight, player.y + dy));

        player.angle = Math.atan2(dy, dx);

        socket.emit('move', {
            x: player.x,
            y: player.y,
            angle: player.angle
        });
    }

    camera.x = player.x - canvas.width / 2;
    camera.y = player.y - canvas.height / 2;

    camera.x = Math.max(0, Math.min(gameState.mapWidth - canvas.width, camera.x));
    camera.y = Math.max(0, Math.min(gameState.mapHeight - canvas.height, camera.y));

    document.getElementById('hp-display').textContent = Math.floor(player.hp);
    document.getElementById('money-display').textContent = player.money;

    smoothPlayers[gameState.playerId] = {
        x: player.x,
        y: player.y,
        angle: player.angle
    };
}

function getSmoothPos(entity, type) {
    const smooth = type === 'player' ? smoothPlayers : (type === 'monster' ? smoothMonsters : smoothBuildings);
    const prev = smooth[entity.id];

    if (!prev) {
        smooth[entity.id] = { x: entity.x, y: entity.y, angle: entity.angle || 0 };
        return { x: entity.x, y: entity.y, angle: entity.angle || 0 };
    }

    const lerp = 0.3;
    prev.x += (entity.x - prev.x) * lerp;
    prev.y += (entity.y - prev.y) * lerp;
    prev.angle = entity.angle || prev.angle;

    return prev;
}

function render() {
    ctx.fillStyle = '#0f0f1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    drawGrid();
    drawResourcePoints();
    drawBuildings();
    drawMonsters();
    drawBullets();
    drawPlayers();

    if (selectedBuild && gameState.myPlayer) {
        drawBuildPreview();
    }

    ctx.restore();

    renderMinimap();
}

function drawGrid() {
    const gridSize = 100;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;

    const startX = Math.floor(camera.x / gridSize) * gridSize;
    const startY = Math.floor(camera.y / gridSize) * gridSize;

    for (let x = startX; x < camera.x + canvas.width + gridSize; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, camera.y);
        ctx.lineTo(x, camera.y + canvas.height);
        ctx.stroke();
    }

    for (let y = startY; y < camera.y + canvas.height + gridSize; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(camera.x, y);
        ctx.lineTo(camera.x + canvas.width, y);
        ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, gameState.mapWidth, gameState.mapHeight);
}

function drawResourcePoints() {
    gameState.resourcePoints.forEach(rp => {
        if (rp.x < camera.x - rp.radius || rp.x > camera.x + canvas.width + rp.radius ||
            rp.y < camera.y - rp.radius || rp.y > camera.y + canvas.height + rp.radius) return;

        const gradient = ctx.createRadialGradient(rp.x, rp.y, 0, rp.x, rp.y, rp.radius);
        gradient.addColorStop(0, 'rgba(0, 255, 100, 0.9)');
        gradient.addColorStop(0.5, 'rgba(0, 255, 100, 0.3)');
        gradient.addColorStop(1, 'rgba(0, 255, 100, 0)');

        ctx.shadowColor = '#0f0';
        ctx.shadowBlur = 20;
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(rp.x, rp.y, rp.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px Arial';
        ctx.textAlign = 'center';
        ctx.globalAlpha = 0.7;
        ctx.fillText('RESOURCE', rp.x, rp.y + 4);
        ctx.globalAlpha = 1;
    });
}

function drawBuildings() {
    gameState.buildings.forEach(b => {
        if (b.x < camera.x - 50 || b.x > camera.x + canvas.width + 50 ||
            b.y < camera.y - 50 || b.y > camera.y + canvas.height + 50) return;

        const colors = {
            wall: '#888',
            turret: '#4488ff',
            dril: '#ff8844',
            mine: '#44ff88'
        };
        const color = colors[b.type];

        ctx.shadowColor = color;
        ctx.shadowBlur = 10;

        switch (b.type) {
            case 'wall':
                ctx.fillStyle = color;
                ctx.fillRect(b.x - 20, b.y - 20, 40, 40);
                ctx.strokeStyle = '#aaa';
                ctx.lineWidth = 2;
                ctx.strokeRect(b.x - 20, b.y - 20, 40, 40);
                break;

            case 'turret':
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(b.x, b.y, 15, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#88aaff';
                ctx.beginPath();
                ctx.arc(b.x, b.y, 8, 0, Math.PI * 2);
                ctx.fill();
                break;

            case 'dril':
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.moveTo(b.x, b.y - 20);
                ctx.lineTo(b.x + 15, b.y + 15);
                ctx.lineTo(b.x - 15, b.y + 15);
                ctx.closePath();
                ctx.fill();
                break;

            case 'mine':
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(b.x, b.y, 12, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#88ffaa';
                ctx.lineWidth = 2;
                ctx.stroke();
                break;
        }

        ctx.shadowBlur = 0;

        const hpPercent = b.hp / b.maxHp;
        if (hpPercent < 1) {
            ctx.fillStyle = '#333';
            ctx.fillRect(b.x - 15, b.y - 30, 30, 5);
            ctx.fillStyle = hpPercent > 0.5 ? '#4f4' : (hpPercent > 0.25 ? '#ff4' : '#f44');
            ctx.fillRect(b.x - 15, b.y - 30, 30 * hpPercent, 5);
        }
    });
}

function drawMonsters() {
    gameState.monsters.forEach(m => {
        const smooth = getSmoothPos(m, 'monster');

        if (smooth.x < camera.x - 30 || smooth.x > camera.x + canvas.width + 30 ||
            smooth.y < camera.y - 30 || smooth.y > camera.y + canvas.height + 30) return;

        if (m.type === 'basic') {
            ctx.shadowColor = '#e94560';
            ctx.shadowBlur = 10;
            ctx.fillStyle = '#e94560';
            ctx.beginPath();
            ctx.arc(smooth.x, smooth.y, 12, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;

            ctx.fillStyle = '#ff6688';
            ctx.beginPath();
            ctx.arc(smooth.x - 4, smooth.y - 4, 3, 0, Math.PI * 2);
            ctx.arc(smooth.x + 4, smooth.y - 4, 3, 0, Math.PI * 2);
            ctx.fill();
        } else if (m.type === 'strong') {
            ctx.shadowColor = '#ff0000';
            ctx.shadowBlur = 15;
            ctx.fillStyle = '#ff0000';
            ctx.beginPath();
            ctx.arc(smooth.x, smooth.y, 18, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;

            ctx.fillStyle = '#ff4444';
            ctx.beginPath();
            ctx.arc(smooth.x - 5, smooth.y - 5, 5, 0, Math.PI * 2);
            ctx.arc(smooth.x + 5, smooth.y - 5, 5, 0, Math.PI * 2);
            ctx.fill();
        }

        const hpPercent = m.hp / m.maxHp;
        if (hpPercent < 1) {
            ctx.fillStyle = '#333';
            ctx.fillRect(smooth.x - 15, smooth.y - 25, 30, 4);
            ctx.fillStyle = '#f44';
            ctx.fillRect(smooth.x - 15, smooth.y - 25, 30 * hpPercent, 4);
        }
    });
}

function drawBullets() {
    gameState.bullets.forEach(b => {
        if (b.x < camera.x - 20 || b.x > camera.x + canvas.width + 20 ||
            b.y < camera.y - 20 || b.y > camera.y + canvas.height + 20) return;

        const color = b.isTurret ? '#88f' : '#ff0';

        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(b.x, b.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - Math.cos(b.angle) * 15, b.y - Math.sin(b.angle) * 15);
        ctx.stroke();
        ctx.globalAlpha = 1;
    });
}

function drawPlayers() {
    Object.values(gameState.players).forEach(p => {
        const smooth = getSmoothPos(p, 'player');

        if (smooth.x < camera.x - 25 || smooth.x > camera.x + canvas.width + 25 ||
            smooth.y < camera.y - 25 || smooth.y > camera.y + canvas.height + 25) return;

        const isMe = p.id === gameState.playerId;
        const color = isMe ? '#00ff88' : '#4488ff';

        ctx.shadowColor = color;
        ctx.shadowBlur = 15;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(smooth.x, smooth.y, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        if (smooth.angle) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(smooth.x, smooth.y);
            ctx.lineTo(
                smooth.x + Math.cos(smooth.angle) * 20,
                smooth.y + Math.sin(smooth.angle) * 20
            );
            ctx.stroke();
        }

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(p.nickname, smooth.x, smooth.y - 25);

        const hpPercent = p.hp / p.maxHp;
        ctx.fillStyle = '#333';
        ctx.fillRect(smooth.x - 20, smooth.y - 18, 40, 6);
        ctx.fillStyle = hpPercent > 0.5 ? '#4f4' : (hpPercent > 0.25 ? '#ff4' : '#f44');
        ctx.fillRect(smooth.x - 20, smooth.y - 18, 40 * hpPercent, 6);
    });
}

function drawBuildPreview() {
    const worldX = mouseX + camera.x;
    const worldY = mouseY + camera.y;

    const costs = {
        wall: 50,
        turret: 100,
        dril: 150,
        mine: 75
    };
    const cost = costs[selectedBuild];

    ctx.globalAlpha = 0.5;

    switch (selectedBuild) {
        case 'wall':
            ctx.fillStyle = '#888';
            ctx.fillRect(worldX - 20, worldY - 20, 40, 40);
            break;
        case 'turret':
            ctx.fillStyle = '#4488ff';
            ctx.beginPath();
            ctx.arc(worldX, worldY, 15, 0, Math.PI * 2);
            ctx.fill();
            break;
        case 'dril':
            ctx.fillStyle = '#ff8844';
            ctx.beginPath();
            ctx.arc(worldX, worldY, 20, 0, Math.PI * 2);
            ctx.fill();
            break;
        case 'mine':
            ctx.fillStyle = '#44ff88';
            ctx.beginPath();
            ctx.arc(worldX, worldY, 12, 0, Math.PI * 2);
            ctx.fill();
            break;
    }

    ctx.globalAlpha = 1;

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`$${cost}`, worldX, worldY + 35);
}

function renderMinimap() {
    const mmW = 150;
    const mmH = 150;

    minimap.width = mmW;
    minimap.height = mmH;

    minimapCtx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    minimapCtx.fillRect(0, 0, mmW, mmH);

    const scaleX = mmW / gameState.mapWidth;
    const scaleY = mmH / gameState.mapHeight;

    minimapCtx.fillStyle = 'rgba(0, 255, 100, 0.3)';
    gameState.resourcePoints.forEach(rp => {
        minimapCtx.beginPath();
        minimapCtx.arc(rp.x * scaleX, rp.y * scaleY, 3, 0, Math.PI * 2);
        minimapCtx.fill();
    });

    minimapCtx.fillStyle = 'rgba(233, 69, 96, 0.5)';
    gameState.monsters.forEach(m => {
        minimapCtx.fillRect(m.x * scaleX - 1, m.y * scaleY - 1, 2, 2);
    });

    minimapCtx.fillStyle = '#4488ff';
    Object.values(gameState.players).forEach(p => {
        minimapCtx.beginPath();
        minimapCtx.arc(p.x * scaleX, p.y * scaleY, 3, 0, Math.PI * 2);
        minimapCtx.fill();
    });

    if (gameState.myPlayer) {
        minimapCtx.strokeStyle = '#fff';
        minimapCtx.lineWidth = 2;
        minimapCtx.strokeRect(
            camera.x * scaleX,
            camera.y * scaleY,
            canvas.width * scaleX,
            canvas.height * scaleY
        );
    }
}

function gameLoop() {
    update();
    render();
    requestAnimationFrame(gameLoop);
}

init();
gameLoop();