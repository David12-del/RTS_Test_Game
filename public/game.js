// =============================================
// SURVIVAL ARENA - CLIENT
// =============================================

const socket = io();

// =============================================
// GAME STATE
// =============================================

const game = {
    id: null,
    mapWidth: 3000,
    mapHeight: 3000,
    players: {},
    buildings: [],
    monsters: [],
    bullets: [],
    myPlayer: null,
    status: 'waiting'
};

const smoothPlayers = {};
const smoothMonsters = {};
const smoothBuildings = {};

let keys = { w: false, a: false, s: false, d: false };
let selectedBuild = null;
let selectedWeapon = 'gun';
let mouseX = 0, mouseY = 0;
let camera = { x: 0, y: 0 };

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const minimapCanvas = document.getElementById('minimap');
const mmCtx = minimapCanvas.getContext('2d');

// =============================================
// INITIALIZATION
// =============================================

function init() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    document.getElementById('create-btn').addEventListener('click', createGame);
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

function createGame() {
    const nick = document.getElementById('nickname-input').value.trim();
    if (!nick) return showError('Enter nickname!');
    socket.emit('createGame', nick);
}

function joinGame() {
    const nick = document.getElementById('nickname-input').value.trim();
    if (!nick) return showError('Enter nickname!');
    socket.emit('join', nick);
}

function respawn() {
    document.getElementById('death-screen').style.display = 'none';
    const nick = document.getElementById('nickname-input').value.trim();
    socket.emit('join', nick);
}

// =============================================
// SOCKET EVENTS
// =============================================

socket.on('gameStatus', (data) => {
    const statusEl = document.getElementById('lobby-status');
    const createBtn = document.getElementById('create-btn');
    const joinBtn = document.getElementById('join-btn');

    if (data.status === 'waiting') {
        statusEl.style.display = 'block';
        statusEl.className = 'lobby-status waiting';
        statusEl.textContent = `Waiting for players... (${data.playerCount} connected)`;

        createBtn.style.display = data.playerCount === 0 ? 'block' : 'none';
        joinBtn.textContent = data.playerCount === 0 ? 'CREATE NEW GAME' : 'JOIN GAME';
    } else if (data.status === 'playing' || data.status === 'paused') {
        statusEl.style.display = 'block';
        statusEl.className = 'lobby-status playing';
        statusEl.textContent = 'Game in progress!';
        joinBtn.textContent = 'JOIN GAME';
    }
});

socket.on('gameStarted', () => {
    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('game-container').style.display = 'block';
});

socket.on('init', (data) => {
    game.id = data.id;
    game.mapWidth = data.mapWidth;
    game.mapHeight = data.mapHeight;
});

socket.on('playerJoined', (player) => {
    game.players[player.id] = player;
    smoothPlayers[player.id] = { x: player.x, y: player.y, angle: player.angle };
});

socket.on('playerLeft', (id) => {
    delete game.players[id];
    delete smoothPlayers[id];
});

socket.on('playerRespawned', (id) => {
    if (id === game.id && game.players[id]) {
        const p = game.players[id];
        p.hp = p.maxHp;
        p.x = game.mapWidth / 2 + (Math.random() - 0.5) * 60;
        p.y = game.mapHeight / 2 + (Math.random() - 0.5) * 60;
    }
});

socket.on('buildingCreated', (building) => {
    game.buildings.push(building);
    smoothBuildings[building.id] = { x: building.x, y: building.y };
});

socket.on('buildingRemoved', (id) => {
    game.buildings = game.buildings.filter(b => b.id !== id);
    delete smoothBuildings[id];
});

socket.on('monsterCreated', (monster) => {
    game.monsters.push(monster);
    smoothMonsters[monster.id] = { x: monster.x, y: monster.y };
});

socket.on('monsterRemoved', (id) => {
    game.monsters = game.monsters.filter(m => m.id !== id);
    delete smoothMonsters[id];
});

socket.on('bulletCreated', (bullet) => {
    game.bullets.push(bullet);
});

socket.on('bulletRemoved', (id) => {
    game.bullets = game.bullets.filter(b => b.id !== id);
});

socket.on('waveStart', (data) => {
    showNotification(`WAVE ${data.wave}`, 'info');
});

socket.on('timer', (data) => {
    const mins = Math.floor(data.nextWaveTime / 60);
    const secs = data.nextWaveTime % 60;
    document.getElementById('wave-timer-val').textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    document.getElementById('wave-num').textContent = data.waveNumber;
});

socket.on('gameState', (state) => {
    game.players = state.players;
    game.buildings = state.buildings;
    game.monsters = state.monsters;
    game.bullets = state.bullets;
    game.status = state.status;
});

socket.on('error', (msg) => showError(msg));
socket.on('buildError', (msg) => showError(msg));

function showError(msg) {
    showNotification(msg, 'error');
}

function showNotification(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `notification ${type}`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2000);
}

// =============================================
// INPUT HANDLING
// =============================================

document.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (keys.hasOwnProperty(key)) keys[key] = true;

    if (key === 'q') { selectedWeapon = 'gun'; updateHotbar(); }
    if (key === 'e') { selectedWeapon = 'gun'; updateHotbar(); }

    if (key === '1') { selectedBuild = selectedBuild === 'wall' ? null : 'wall'; updateBuildMenu(); }
    if (key === '2') { selectedBuild = selectedBuild === 'turret' ? null : 'turret'; updateBuildMenu(); }
    if (key === '3') { selectedBuild = selectedBuild === 'dril' ? null : 'dril'; updateBuildMenu(); }
    if (key === '4') { selectedBuild = selectedBuild === 'mine' ? null : 'mine'; updateBuildMenu(); }

    document.getElementById('build-menu').classList.toggle('visible', selectedBuild !== null);
});

document.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if (keys.hasOwnProperty(key)) keys[key] = false;
});

canvas.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    updateCrosshair(e);
});

canvas.addEventListener('click', (e) => {
    if (!game.myPlayer || !selectedBuild) return;

    socket.emit('build', {
        type: selectedBuild,
        x: mouseX + camera.x,
        y: mouseY + camera.y
    });
});

canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!game.myPlayer) return;

    const angle = Math.atan2(mouseY + camera.y - game.myPlayer.y, mouseX + camera.x - game.myPlayer.x);
    socket.emit('shoot', { angle });
});

function updateCrosshair(e) {
    const crosshair = document.getElementById('crosshair');
    if (game.status === 'playing') {
        crosshair.style.display = 'block';
        crosshair.style.left = e.clientX + 'px';
        crosshair.style.top = e.clientY + 'px';
    }
}

function updateHotbar() {
    document.querySelectorAll('.hotbar-slot').forEach(el => {
        el.classList.toggle('active', el.dataset.slot === selectedWeapon);
    });
}

function updateBuildMenu() {
    document.querySelectorAll('.build-option').forEach(el => {
        el.classList.toggle('active', el.dataset.type === selectedBuild);
    });
}

// =============================================
// GAME LOOP
// =============================================

function update() {
    if (!game.id || !game.players[game.id] || game.status !== 'playing') return;

    game.myPlayer = game.players[game.id];

    if (game.myPlayer.hp <= 0) {
        document.getElementById('death-screen').style.display = 'flex';
        document.getElementById('crosshair').style.display = 'none';
        return;
    }

    document.getElementById('death-screen').style.display = 'none';
    document.getElementById('crosshair').style.display = 'block';

    const p = game.myPlayer;
    let dx = 0, dy = 0;

    if (keys.w) dy -= p.speed;
    if (keys.s) dy += p.speed;
    if (keys.a) dx -= p.speed;
    if (keys.d) dx += p.speed;

    if (dx !== 0 || dy !== 0) {
        const len = Math.sqrt(dx * dx + dy * dy);
        dx = (dx / len) * p.speed;
        dy = (dy / len) * p.speed;

        p.x = Math.max(15, Math.min(game.mapWidth - 15, p.x + dx));
        p.y = Math.max(15, Math.min(game.mapHeight - 15, p.y + dy));

        p.angle = Math.atan2(dy, dx);

        socket.emit('move', { x: p.x, y: p.y, angle: p.angle });
    }

    camera.x = p.x - canvas.width / 2;
    camera.y = p.y - canvas.height / 2;
    camera.x = Math.max(0, Math.min(game.mapWidth - canvas.width, camera.x));
    camera.y = Math.max(0, Math.min(game.mapHeight - canvas.height, camera.y));

    document.getElementById('hp-display').textContent = Math.floor(p.hp);
    document.getElementById('hp-bar').style.width = (p.hp / p.maxHp * 100) + '%';
    document.getElementById('money-display').textContent = p.money;
    document.getElementById('ammo-display').textContent = p.ammo;

    smoothPlayers[p.id] = { x: p.x, y: p.y, angle: p.angle };
}

function getSmoothPos(entity, type) {
    const smooth = type === 'player' ? smoothPlayers : smoothMonsters;
    let s = smooth[entity.id];

    if (!s) {
        s = { x: entity.x, y: entity.y, angle: entity.angle || 0 };
        smooth[entity.id] = s;
        return s;
    }

    const lerp = 0.35;
    s.x += (entity.x - s.x) * lerp;
    s.y += (entity.y - s.y) * lerp;
    s.angle = entity.angle || s.angle;
    return s;
}

// =============================================
// RENDERING
// =============================================

function render() {
    ctx.fillStyle = '#08080c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    drawGrid();
    drawResourcePoints();
    drawBuildings();
    drawMonsters();
    drawBullets();
    drawPlayers();

    if (selectedBuild && game.myPlayer) {
        drawBuildPreview();
    }

    ctx.restore();

    renderMinimap();
}

function drawGrid() {
    const size = 100;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;

    for (let x = Math.floor(camera.x / size) * size; x < camera.x + canvas.width + size; x += size) {
        ctx.beginPath(); ctx.moveTo(x, camera.y); ctx.lineTo(x, camera.y + canvas.height); ctx.stroke();
    }
    for (let y = Math.floor(camera.y / size) * size; y < camera.y + canvas.height + size; y += size) {
        ctx.beginPath(); ctx.moveTo(camera.x, y); ctx.lineTo(camera.x + canvas.width, y); ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(233, 69, 96, 0.3)';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, game.mapWidth, game.mapHeight);
}

function drawResourcePoints() {
    game.buildings.filter(b => b.type === 'spawner').forEach(rp => {
        if (Math.abs(rp.x - camera.x) > 400 || Math.abs(rp.y - camera.y) > 400) return;

        const gradient = ctx.createRadialGradient(rp.x, rp.y, 0, rp.x, rp.y, 50);
        gradient.addColorStop(0, 'rgba(233, 69, 96, 0.4)');
        gradient.addColorStop(1, 'rgba(233, 69, 96, 0)');

        ctx.fillStyle = gradient;
        ctx.beginPath(); ctx.arc(rp.x, rp.y, 50, 0, Math.PI * 2); ctx.fill();

        ctx.fillStyle = '#e94560';
        ctx.beginPath(); ctx.arc(rp.x, rp.y, 15, 0, Math.PI * 2); ctx.fill();

        ctx.fillStyle = '#ff6688';
        ctx.font = 'bold 10px Orbitron';
        ctx.textAlign = 'center';
        ctx.fillText('SPAWN', rp.x, rp.y + 30);
    });

    game.buildings.filter(b => b.type === 'command_center').forEach(cc => {
        ctx.shadowColor = '#4488ff';
        ctx.shadowBlur = 30;

        ctx.fillStyle = '#1a1a3e';
        ctx.beginPath();
        ctx.arc(cc.x, cc.y, 50, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#4488ff';
        ctx.lineWidth = 4;
        ctx.stroke();

        ctx.fillStyle = '#4488ff';
        ctx.beginPath();
        ctx.arc(cc.x, cc.y, 25, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#88aaff';
        ctx.beginPath();
        ctx.arc(cc.x, cc.y, 12, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowBlur = 0;

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px Orbitron';
        ctx.textAlign = 'center';
        ctx.fillText('COMMAND', cc.x, cc.y + 70);
    });
}

function drawBuildings() {
    game.buildings.forEach(b => {
        if (b.type === 'spawner' || b.type === 'command_center') return;

        const colors = { wall: '#666', turret: '#4488ff', dril: '#ff8844', mine: '#44ff88' };
        const color = colors[b.type];

        ctx.shadowColor = color;
        ctx.shadowBlur = 15;

        switch (b.type) {
            case 'wall':
                ctx.fillStyle = color;
                ctx.fillRect(b.x - 20, b.y - 20, 40, 40);
                ctx.strokeStyle = '#888';
                ctx.lineWidth = 2;
                ctx.strokeRect(b.x - 20, b.y - 20, 40, 40);
                break;
            case 'turret':
                ctx.fillStyle = color;
                ctx.beginPath(); ctx.arc(b.x, b.y, 15, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#88aaff';
                ctx.beginPath(); ctx.arc(b.x, b.y, 8, 0, Math.PI * 2); ctx.fill();
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
                ctx.beginPath(); ctx.arc(b.x, b.y, 12, 0, Math.PI * 2); ctx.fill();
                ctx.strokeStyle = '#88ffaa';
                ctx.lineWidth = 2;
                ctx.stroke();
                break;
        }

        ctx.shadowBlur = 0;

        const hp = b.hp / b.maxHp;
        if (hp < 1) {
            ctx.fillStyle = '#222';
            ctx.fillRect(b.x - 15, b.y - 28, 30, 4);
            ctx.fillStyle = hp > 0.5 ? '#4f4' : hp > 0.25 ? '#ff4' : '#f44';
            ctx.fillRect(b.x - 15, b.y - 28, 30 * hp, 4);
        }
    });
}

function drawMonsters() {
    game.monsters.forEach(m => {
        const s = getSmoothPos(m, 'monster');

        ctx.shadowColor = m.type === 'strong' ? '#ff0000' : '#e94560';
        ctx.shadowBlur = 15;

        ctx.fillStyle = m.type === 'strong' ? '#cc0000' : '#e94560';
        ctx.beginPath(); ctx.arc(s.x, s.y, m.type === 'strong' ? 18 : 12, 0, Math.PI * 2); ctx.fill();

        ctx.fillStyle = '#ff6688';
        ctx.beginPath(); ctx.arc(s.x - 4, s.y - 4, 3, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(s.x + 4, s.y - 4, 3, 0, Math.PI * 2); ctx.fill();

        ctx.shadowBlur = 0;

        const hp = m.hp / m.maxHp;
        if (hp < 1) {
            ctx.fillStyle = '#222';
            ctx.fillRect(s.x - 12, s.y - 22, 24, 3);
            ctx.fillStyle = '#f44';
            ctx.fillRect(s.x - 12, s.y - 22, 24 * hp, 3);
        }
    });
}

function drawBullets() {
    game.bullets.forEach(b => {
        const color = b.type === 'laser' ? '#4488ff' : b.type === 'turret' ? '#88f' : '#ff0';

        ctx.shadowColor = color;
        ctx.shadowBlur = 12;
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.type === 'laser' ? 8 : 5, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;

        if (b.type === 'laser') {
            ctx.strokeStyle = color;
            ctx.globalAlpha = 0.5;
            ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - Math.cos(b.angle) * 40, b.y - Math.sin(b.angle) * 40); ctx.stroke();
            ctx.globalAlpha = 1;
        }
    });
}

function drawPlayers() {
    Object.values(game.players).forEach(p => {
        const s = getSmoothPos(p, 'player');

        if (Math.abs(s.x - camera.x) > 400 || Math.abs(s.y - camera.y) > 400) return;

        const isMe = p.id === game.id;
        const color = isMe ? '#00ff88' : '#4488ff';

        ctx.shadowColor = color;
        ctx.shadowBlur = 20;
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(s.x, s.y, 15, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;

        if (s.angle) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + Math.cos(s.angle) * 22, s.y + Math.sin(s.angle) * 22); ctx.stroke();
        }

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px Orbitron';
        ctx.textAlign = 'center';
        ctx.fillText(p.nickname, s.x, s.y - 25);

        const hp = p.hp / p.maxHp;
        ctx.fillStyle = '#222';
        ctx.fillRect(s.x - 15, s.y - 16, 30, 4);
        ctx.fillStyle = hp > 0.5 ? '#4f4' : '#f44';
        ctx.fillRect(s.x - 15, s.y - 16, 30 * hp, 4);
    });
}

function drawBuildPreview() {
    const wx = mouseX + camera.x;
    const wy = mouseY + camera.y;
    const costs = { wall: 50, turret: 100, dril: 150, mine: 75 };
    const cost = costs[selectedBuild];

    ctx.globalAlpha = 0.6;
    ctx.fillStyle = selectedBuild === 'wall' ? '#666' : selectedBuild === 'turret' ? '#4488ff' : selectedBuild === 'dril' ? '#ff8844' : '#44ff88';

    if (selectedBuild === 'wall') ctx.fillRect(wx - 20, wy - 20, 40, 40);
    else { ctx.beginPath(); ctx.arc(wx, wy, 15, 0, Math.PI * 2); ctx.fill(); }

    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px Orbitron';
    ctx.textAlign = 'center';
    ctx.fillText(`$${cost}`, wx, wy + 35);
}

function renderMinimap() {
    const w = 180, h = 180;
    minimapCanvas.width = w;
    minimapCanvas.height = h;

    mmCtx.fillStyle = 'rgba(10, 10, 20, 0.9)';
    mmCtx.fillRect(0, 0, w, h);

    const sx = w / game.mapWidth;
    const sy = h / game.mapHeight;

    game.buildings.filter(b => b.type === 'spawner').forEach(b => {
        mmCtx.fillStyle = 'rgba(233, 69, 96, 0.5)';
        mmCtx.fillRect(b.x * sx - 2, b.y * sy - 2, 4, 4);
    });

    game.buildings.filter(b => b.type === 'command_center').forEach(b => {
        mmCtx.fillStyle = '#4488ff';
        mmCtx.fillRect(b.x * sx - 4, b.y * sy - 4, 8, 8);
    });

    mmCtx.fillStyle = 'rgba(233, 69, 96, 0.6)';
    game.monsters.forEach(m => {
        mmCtx.fillRect(m.x * sx - 1, m.y * sy - 1, 2, 2);
    });

    mmCtx.fillStyle = '#00ff88';
    Object.values(game.players).forEach(p => {
        mmCtx.beginPath(); mmCtx.arc(p.x * sx, p.y * sy, 3, 0, Math.PI * 2); mmCtx.fill();
    });

    if (game.myPlayer) {
        mmCtx.strokeStyle = '#fff';
        mmCtx.lineWidth = 2;
        mmCtx.strokeRect(camera.x * sx, camera.y * sy, canvas.width * sx, canvas.height * sy);
    }
}

function gameLoop() {
    update();
    render();
    requestAnimationFrame(gameLoop);
}

init();
gameLoop();