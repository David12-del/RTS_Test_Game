// =============================================
// SURVIVAL ARENA - CLIENT
// =============================================

const socket = io();

// =============================================
// STATE
// =============================================

const game = {
    id: null, code: null,
    mapWidth: 2000, mapHeight: 2000,
    players: {}, buildings: [], monsters: [], bullets: [],
    myPlayer: null, status: 'lobby'
};

const smoothPlayers = {};
const smoothMonsters = {};

let keys = { w: false, a: false, s: false, d: false };
let mouseX = 0, mouseY = 0;
let camera = { x: 0, y: 0 };
let buildMenuOpen = false;
let selectedBuild = null;

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const mmCanvas = document.getElementById('minimap');
const mmCtx = mmCanvas.getContext('2d');

// =============================================
// INIT
// =============================================

function init() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    document.getElementById('create-btn').addEventListener('click', createLobby);
    document.getElementById('join-btn').addEventListener('click', toggleJoin);
    document.getElementById('start-btn').addEventListener('click', startGame);
    document.getElementById('nickname').addEventListener('keypress', e => { if (e.key === 'Enter') createLobby(); });
    document.getElementById('room-code').addEventListener('keypress', e => { if (e.key === 'Enter') joinLobby(); });
    document.getElementById('respawn-btn').addEventListener('click', respawn);

    document.querySelectorAll('.build-option').forEach(el => {
        el.addEventListener('click', () => {
            selectedBuild = el.dataset.type;
            updateBuildMenu();
        });
    });

    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    });
}

function createLobby() {
    const nick = document.getElementById('nickname').value.trim();
    if (!nick) return showError('Enter nickname!');
    socket.emit('createLobby', { nickname: nick });
}

function toggleJoin() {
    const row = document.getElementById('code-row');
    const btn = document.getElementById('join-btn');
    if (row.style.display === 'none') {
        row.style.display = 'flex';
        document.getElementById('room-code').focus();
        btn.textContent = 'JOIN →';
        btn.onclick = joinLobby;
    } else {
        row.style.display = 'none';
        btn.textContent = 'JOIN';
        btn.onclick = toggleJoin;
    }
}

function joinLobby() {
    const nick = document.getElementById('nickname').value.trim();
    const code = document.getElementById('room-code').value.trim();
    if (!nick) return showError('Enter nickname!');
    if (!code || code.length < 4) return showError('Enter valid code!');
    socket.emit('joinLobby', { nickname: nick, code: code });
}

function startGame() { socket.emit('startGame'); }

function respawn() {
    document.getElementById('death-screen').style.display = 'none';
    socket.emit('joinLobby', {
        nickname: document.getElementById('nickname').value.trim(),
        code: game.code
    });
}

// =============================================
// SOCKET
// =============================================

socket.on('lobbyCreated', data => {
    game.code = data.code;
    game.status = 'lobby';
    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('players-list').style.display = 'block';
    document.getElementById('start-btn').classList.add('visible');
    showNotification(`Room: ${data.code}`, 'info');
});

socket.on('error', msg => showError(msg));

socket.on('lobbyUpdate', data => {
    const container = document.getElementById('players-container');
    container.innerHTML = '';
    data.players.forEach(p => {
        const isHost = p.id === data.creatorId;
        container.innerHTML += `
            <div class="player-row">
                <div class="player-dot"></div>
                <span class="player-name">${p.nickname}</span>
                ${isHost ? '<span class="host-badge">HOST</span>' : ''}
            </div>
        `;
    });
    const st = document.getElementById('lobby-status');
    st.className = data.status === 'waiting' ? 'lobby-status waiting' : 'lobby-status playing';
    st.textContent = data.status === 'waiting' ? 'Waiting for host...' : 'Game in progress!';
});

socket.on('newCreator', id => {
    if (id === game.id) document.getElementById('start-btn').classList.add('visible');
});

socket.on('gameStart', data => {
    game.code = data.code;
    game.mapWidth = data.mapWidth;
    game.mapHeight = data.mapHeight;
    game.status = 'playing';
    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('game-container').style.display = 'block';
    game.players = {}; game.monsters = []; game.buildings = []; game.bullets = [];
});

socket.on('playerJoined', p => {
    game.players[p.id] = p;
    smoothPlayers[p.id] = { x: p.x, y: p.y, angle: p.angle };
});

socket.on('playerLeft', id => {
    delete game.players[id];
    delete smoothPlayers[id];
});

socket.on('playerRespawned', id => {
    if (id === game.id && game.players[id]) {
        const p = game.players[id];
        p.hp = p.maxHp;
        p.x = game.mapWidth/2 + (Math.random()-0.5)*40;
        p.y = game.mapHeight/2 + (Math.random()-0.5)*40;
    }
});

socket.on('buildingCreated', b => game.buildings.push(b));
socket.on('buildingRemoved', id => game.buildings = game.buildings.filter(b => b.id !== id));

socket.on('monsterCreated', m => {
    game.monsters.push(m);
    smoothMonsters[m.id] = { x: m.x, y: m.y };
});

socket.on('monsterRemoved', id => {
    game.monsters = game.monsters.filter(m => m.id !== id);
    delete smoothMonsters[id];
});

socket.on('bulletCreated', b => game.bullets.push(b));
socket.on('bulletRemoved', id => game.bullets = game.bullets.filter(b => b.id !== id));

socket.on('waveStart', d => showNotification(`WAVE ${d.wave} - ${d.monsterCount} enemies!`, 'info'));

socket.on('timer', d => {
    const m = Math.floor(d.nextWaveTime / 60);
    const s = d.nextWaveTime % 60;
    document.getElementById('wave-timer-val').textContent = `${m}:${s.toString().padStart(2,'0')}`;
    document.getElementById('wave-num').textContent = d.waveNumber;
});

socket.on('gameState', state => {
    game.players = state.players;
    game.buildings = state.buildings;
    game.monsters = state.monsters;
    game.bullets = state.bullets;
    game.status = state.status;
});

function showError(msg) { showNotification(msg, 'error'); }

function showNotification(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `notification ${type}`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
}

// =============================================
// INPUT
// =============================================

document.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (keys.hasOwnProperty(k)) keys[k] = true;
    if (k === 'b') {
        buildMenuOpen = !buildMenuOpen;
        document.getElementById('build-menu').classList.toggle('visible', buildMenuOpen);
        if (!buildMenuOpen) selectedBuild = null;
    }
    if (buildMenuOpen) {
        if (k === '1') selectedBuild = selectedBuild === 'wall' ? null : 'wall';
        if (k === '2') selectedBuild = selectedBuild === 'turret' ? null : 'turret';
        if (k === '3') selectedBuild = selectedBuild === 'dril' ? null : 'dril';
        if (k === '4') selectedBuild = selectedBuild === 'mine' ? null : 'mine';
        updateBuildMenu();
    }
});

document.addEventListener('keyup', e => {
    const k = e.key.toLowerCase();
    if (keys.hasOwnProperty(k)) keys[k] = false;
});

canvas.addEventListener('mousemove', e => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    document.getElementById('crosshair').style.left = e.clientX + 'px';
    document.getElementById('crosshair').style.top = e.clientY + 'px';
});

canvas.addEventListener('click', e => {
    if (!game.myPlayer || game.status !== 'playing' || game.myPlayer.hp <= 0) return;

    if (buildMenuOpen && selectedBuild) {
        socket.emit('build', { type: selectedBuild, x: mouseX + camera.x, y: mouseY + camera.y });
    } else {
        const angle = Math.atan2(mouseY + camera.y - game.myPlayer.y, mouseX + camera.x - game.myPlayer.x);
        socket.emit('shoot', { angle });
    }
});

function updateBuildMenu() {
    document.querySelectorAll('.build-option').forEach(el => {
        el.classList.toggle('active', el.dataset.type === selectedBuild);
    });
}

// =============================================
// UPDATE
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
        const len = Math.sqrt(dx*dx + dy*dy);
        dx = (dx/len) * p.speed;
        dy = (dy/len) * p.speed;
        p.x = Math.max(15, Math.min(game.mapWidth-15, p.x + dx));
        p.y = Math.max(15, Math.min(game.mapHeight-15, p.y + dy));
        p.angle = Math.atan2(dy, dx);
        socket.emit('move', { x: p.x, y: p.y, angle: p.angle });
    }

    camera.x = p.x - canvas.width/2;
    camera.y = p.y - canvas.height/2;
    camera.x = Math.max(0, Math.min(game.mapWidth - canvas.width, camera.x));
    camera.y = Math.max(0, Math.min(game.mapHeight - canvas.height, camera.y));

    document.getElementById('hp-display').textContent = Math.floor(p.hp);
    document.getElementById('hp-bar').style.width = (p.hp/p.maxHp*100)+'%';
    document.getElementById('money-display').textContent = p.money;

    smoothPlayers[p.id] = { x: p.x, y: p.y, angle: p.angle };
}

function getSmooth(entity, type) {
    const s = type === 'player' ? smoothPlayers : smoothMonsters;
    let p = s[entity.id];
    if (!p) { p = { x: entity.x, y: entity.y, angle: entity.angle||0 }; s[entity.id] = p; return p; }
    const lerp = 0.35;
    p.x += (entity.x - p.x) * lerp;
    p.y += (entity.y - p.y) * lerp;
    p.angle = entity.angle || p.angle;
    return p;
}

// =============================================
// RENDER
// =============================================

function render() {
    ctx.fillStyle = '#08080c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    drawGrid();
    drawBuildings();
    drawMonsters();
    drawBullets();
    drawPlayers();

    if (buildMenuOpen && selectedBuild && game.myPlayer) drawBuildPreview();

    ctx.restore();
    renderMinimap();
}

function drawGrid() {
    const s = 100;
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    for (let x = Math.floor(camera.x/s)*s; x < camera.x+canvas.width+s; x+=s) {
        ctx.beginPath(); ctx.moveTo(x,camera.y); ctx.lineTo(x,camera.y+canvas.height); ctx.stroke();
    }
    for (let y = Math.floor(camera.y/s)*s; y < camera.y+canvas.height+s; y+=s) {
        ctx.beginPath(); ctx.moveTo(camera.x,y); ctx.lineTo(camera.x+canvas.width,y); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(233,69,96,0.25)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, game.mapWidth, game.mapHeight);
}

function drawBuildings() {
    game.buildings.filter(b => b.type === 'spawner').forEach(b => {
        if (Math.abs(b.x-camera.x)>350 || Math.abs(b.y-camera.y)>350) return;
        const g = ctx.createRadialGradient(b.x,b.y,0,b.x,b.y,35);
        g.addColorStop(0, 'rgba(233,69,96,0.4)'); g.addColorStop(1,'rgba(233,69,96,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.x,b.y,35,0,Math.PI*2); ctx.fill();
        ctx.fillStyle = '#e94560'; ctx.beginPath(); ctx.arc(b.x,b.y,10,0,Math.PI*2); ctx.fill();
    });

    game.buildings.filter(b => b.type === 'command_center').forEach(cc => {
        ctx.shadowColor = '#4488ff'; ctx.shadowBlur = 20;
        ctx.fillStyle = '#1a1a3e'; ctx.beginPath(); ctx.arc(cc.x,cc.y,40,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle = '#4488ff'; ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = '#4488ff'; ctx.beginPath(); ctx.arc(cc.x,cc.y,18,0,Math.PI*2); ctx.fill();
        ctx.fillStyle = '#88aaff'; ctx.beginPath(); ctx.arc(cc.x,cc.y,8,0,Math.PI*2); ctx.fill();
        ctx.shadowBlur = 0;
    });

    game.buildings.filter(b => b.type && !['spawner','command_center'].includes(b.type)).forEach(b => {
        const cols = { wall:'#666', turret:'#4488ff', dril:'#ff8844', mine:'#44ff88' };
        const c = cols[b.type]||'#888';
        ctx.shadowColor = c; ctx.shadowBlur = 10;
        if (b.type === 'wall') { ctx.fillStyle=c; ctx.fillRect(b.x-16,b.y-16,32,32); ctx.strokeStyle='#888'; ctx.strokeRect(b.x-16,b.y-16,32,32); }
        else if (b.type === 'turret') { ctx.fillStyle=c; ctx.beginPath(); ctx.arc(b.x,b.y,12,0,Math.PI*2); ctx.fill(); ctx.fillStyle='#88aaff'; ctx.beginPath(); ctx.arc(b.x,b.y,5,0,Math.PI*2); ctx.fill(); }
        else if (b.type === 'dril') { ctx.fillStyle=c; ctx.beginPath(); ctx.moveTo(b.x,b.y-15); ctx.lineTo(b.x+12,b.y+12); ctx.lineTo(b.x-12,b.y+12); ctx.closePath(); ctx.fill(); }
        else if (b.type === 'mine') { ctx.fillStyle=c; ctx.beginPath(); ctx.arc(b.x,b.y,9,0,Math.PI*2); ctx.fill(); }
        ctx.shadowBlur = 0;
        const hp = b.hp/b.maxHp;
        if (hp < 1) { ctx.fillStyle='#222'; ctx.fillRect(b.x-10,b.y-22,20,3); ctx.fillStyle=hp>0.5?'#4f4':'#f44'; ctx.fillRect(b.x-10,b.y-22,20*hp,3); }
    });
}

function drawMonsters() {
    game.monsters.forEach(m => {
        const s = getSmooth(m, 'monster');
        ctx.shadowColor = m.type==='strong'?'#ff0000':'#e94560'; ctx.shadowBlur = 10;
        ctx.fillStyle = m.type==='strong'?'#cc0000':'#e94560';
        ctx.beginPath(); ctx.arc(s.x,s.y,m.type==='strong'?14:10,0,Math.PI*2); ctx.fill();
        ctx.shadowBlur = 0;
    });
}

function drawBullets() {
    game.bullets.forEach(b => {
        const c = b.type==='laser'?'#4488ff':b.type==='turret'?'#88f':'#ff0';
        ctx.shadowColor=c; ctx.shadowBlur=8;
        ctx.fillStyle=c; ctx.beginPath(); ctx.arc(b.x,b.y,b.type==='laser'?6:4,0,Math.PI*2); ctx.fill();
        ctx.shadowBlur=0;
    });
}

function drawPlayers() {
    Object.values(game.players).forEach(p => {
        if (p.hp <= 0) return;
        const s = getSmooth(p, 'player');
        if (Math.abs(s.x-camera.x)>350 || Math.abs(s.y-camera.y)>350) return;
        const isMe = p.id === game.id;
        const c = isMe?'#00ff88':'#4488ff';
        ctx.shadowColor=c; ctx.shadowBlur=12;
        ctx.fillStyle=c; ctx.beginPath(); ctx.arc(s.x,s.y,13,0,Math.PI*2); ctx.fill();
        ctx.shadowBlur=0;
        if (s.angle) { ctx.strokeStyle=c; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(s.x,s.y); ctx.lineTo(s.x+Math.cos(s.angle)*18,s.y+Math.sin(s.angle)*18); ctx.stroke(); }
        ctx.fillStyle='#fff'; ctx.font='bold 10px sans-serif'; ctx.textAlign='center'; ctx.fillText(p.nickname,s.x,s.y-20);
    });
}

function drawBuildPreview() {
    const wx = mouseX + camera.x, wy = mouseY + camera.y;
    const costs = { wall:30, turret:50, dril:80, mine:40 };
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = selectedBuild==='wall'?'#666':selectedBuild==='turret'?'#4488ff':selectedBuild==='dril'?'#ff8844':'#44ff88';
    if (selectedBuild==='wall') ctx.fillRect(wx-16,wy-16,32,32);
    else { ctx.beginPath(); ctx.arc(wx,wy,selectedBuild==='dril'?15:12,0,Math.PI*2); ctx.fill(); }
    ctx.globalAlpha = 1;
    ctx.fillStyle='#fff'; ctx.font='bold 12px sans-serif'; ctx.textAlign='center'; ctx.fillText('$' + costs[selectedBuild], wx, wy+30);
}

function renderMinimap() {
    const w = 140, h = 140;
    mmCanvas.width = w; mmCanvas.height = h;
    mmCtx.fillStyle = 'rgba(10,10,18,0.9)'; mmCtx.fillRect(0,0,w,h);
    const sx = w/game.mapWidth, sy = h/game.mapHeight;

    game.buildings.filter(b=>b.type==='spawner').forEach(b => { mmCtx.fillStyle='rgba(233,69,96,0.5)'; mmCtx.fillRect(b.x*sx-2,b.y*sy-2,4,4); });
    game.buildings.filter(b=>b.type==='command_center').forEach(b => { mmCtx.fillStyle='#4488ff'; mmCtx.fillRect(b.x*sx-3,b.y*sy-3,6,6); });

    mmCtx.fillStyle='rgba(233,69,96,0.6)';
    game.monsters.forEach(m => mmCtx.fillRect(m.x*sx-1,m.y*sy-1,2,2));

    mmCtx.fillStyle='#00ff88';
    Object.values(game.players).forEach(p => { if(p.hp>0) { mmCtx.beginPath(); mmCtx.arc(p.x*sx,p.y*sy,2,0,Math.PI*2); mmCtx.fill(); }});

    if (game.myPlayer) { mmCtx.strokeStyle='#fff'; mmCtx.lineWidth=1; mmCtx.strokeRect(camera.x*sx,camera.y*sy,canvas.width*sx,canvas.height*sy); }
}

function gameLoop() { update(); render(); requestAnimationFrame(gameLoop); }

init();
gameLoop();