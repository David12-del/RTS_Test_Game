const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// CONFIG
// ============================================

const CONFIG = {
    MAP_WIDTH: 2000,
    MAP_HEIGHT: 2000,
    PLAYER_SPEED: 4,
    PLAYER_RADIUS: 15,
    SPAWNER_COUNT: 4,
    BASE_MONSTERS: 3,
    MONSTERS_PER_PLAYER: 2,
    WAVE_DELAY: 90,
    BUILD_COSTS: { wall: 30, turret: 50, dril: 80, mine: 40 },
    BUILD_RANGE: 120,
    PASSIVE_INCOME: 2
};

// ============================================
// LOBBY SYSTEM
// ============================================

const lobbies = new Map();

function createLobby() {
    const code = String(1000 + Math.floor(Math.random() * 9000));
    const lobby = {
        code,
        creatorId: null,
        status: 'waiting',
        players: {},
        buildings: {},
        monsters: [],
        bullets: [],
        resourcePoints: [],
        waveNumber: 0,
        nextWaveTime: CONFIG.WAVE_DELAY
    };

    // Resource points
    for (let i = 0; i < 12; i++) {
        lobby.resourcePoints.push({
            id: i,
            x: 150 + Math.random() * (CONFIG.MAP_WIDTH - 300),
            y: 150 + Math.random() * (CONFIG.MAP_HEIGHT - 300),
            radius: 25
        });
    }

    // Command Center
    lobby.buildings['cc'] = {
        id: 'cc', type: 'command_center',
        x: CONFIG.MAP_WIDTH / 2,
        y: CONFIG.MAP_HEIGHT / 2,
        hp: 1000, maxHp: 1000, shootCooldown: 0
    };

    // Spawners
    for (let i = 0; i < CONFIG.SPAWNER_COUNT; i++) {
        const x = 100 + Math.random() * (CONFIG.MAP_WIDTH - 200);
        const y = 100 + Math.random() * (CONFIG.MAP_HEIGHT - 200);
        if (Math.abs(x - CONFIG.MAP_WIDTH/2) > 150 && Math.abs(y - CONFIG.MAP_HEIGHT/2) > 150) {
            lobby.buildings['spawner_'+i] = { id: 'spawner_'+i, type: 'spawner', x, y, hp: 300, maxHp: 300 };
        }
    }

    lobbies.set(code, lobby);
    return lobby;
}

// ============================================
// SOCKET HANDLERS
// ============================================

io.on('connection', (socket) => {
    console.log('Player:', socket.id);
    let currentLobby = null;

    socket.on('createLobby', (data) => {
        const lobby = createLobby();
        lobby.creatorId = socket.id;

        const player = {
            id: socket.id,
            nickname: data.nickname || 'Player',
            x: CONFIG.MAP_WIDTH/2 + (Math.random()-0.5)*40,
            y: CONFIG.MAP_HEIGHT/2 + (Math.random()-0.5)*40,
            hp: 100, maxHp: 100,
            money: 80,
            ammo: 30,
            angle: 0,
            incomeTimer: 0
        };

        lobby.players[socket.id] = player;
        currentLobby = lobby;
        socket.join(lobby.code);

        socket.emit('lobbyCreated', { code: lobby.code, isCreator: true });
        io.to(lobby.code).emit('lobbyUpdate', getLobbyInfo(lobby));
    });

    socket.on('joinLobby', (data) => {
        const lobby = lobbies.get(data.code);
        if (!lobby) {
            socket.emit('error', 'Room not found');
            return;
        }

        const player = {
            id: socket.id,
            nickname: data.nickname || 'Player',
            x: CONFIG.MAP_WIDTH/2 + (Math.random()-0.5)*40,
            y: CONFIG.MAP_HEIGHT/2 + (Math.random()-0.5)*40,
            hp: 100, maxHp: 100,
            money: 80,
            ammo: 30,
            angle: 0,
            incomeTimer: 0
        };

        lobby.players[socket.id] = player;
        currentLobby = lobby;
        socket.join(lobby.code);

        io.to(lobby.code).emit('lobbyUpdate', getLobbyInfo(lobby));
    });

    socket.on('startGame', () => {
        if (!currentLobby || currentLobby.creatorId !== socket.id) return;
        if (Object.keys(currentLobby.players).length < 1) return;

        currentLobby.status = 'playing';
        io.to(currentLobby.code).emit('gameStart', {
            code: currentLobby.code,
            mapWidth: CONFIG.MAP_WIDTH,
            mapHeight: CONFIG.MAP_HEIGHT,
            resourcePoints: currentLobby.resourcePoints
        });
    });

    socket.on('move', (data) => {
        if (!currentLobby || !currentLobby.players[socket.id]) return;
        const p = currentLobby.players[socket.id];
        if (p.hp <= 0) return;

        p.x = Math.max(15, Math.min(CONFIG.MAP_WIDTH - 15, data.x));
        p.y = Math.max(15, Math.min(CONFIG.MAP_HEIGHT - 15, data.y));
        p.angle = data.angle || 0;
    });

    socket.on('shoot', (data) => {
        if (!currentLobby || !currentLobby.players[socket.id]) return;
        const p = currentLobby.players[socket.id];
        if (p.hp <= 0 || p.ammo <= 0) return;

        p.ammo--;

        const bullet = {
            id: 'b_'+Date.now()+Math.random(),
            x: p.x, y: p.y,
            angle: data.angle,
            speed: 12,
            ownerId: socket.id,
            damage: 20,
            life: 50,
            type: 'player'
        };

        currentLobby.bullets.push(bullet);
        io.to(currentLobby.code).emit('bulletCreated', bullet);
    });

    socket.on('build', (data) => {
        if (!currentLobby || !currentLobby.players[socket.id]) return;
        const p = currentLobby.players[socket.id];
        if (p.hp <= 0) return;

        const cost = CONFIG.BUILD_COSTS[data.type];
        if (!cost || p.money < cost) {
            socket.emit('buildError', 'Not enough money!');
            return;
        }

        // Check build range from existing buildings
        let nearBase = false;
        for (const b of Object.values(currentLobby.buildings)) {
            const dist = Math.sqrt((data.x - b.x)**2 + (data.y - b.y)**2);
            if (dist < CONFIG.BUILD_RANGE) { nearBase = true; break; }
        }

        if (!nearBase && data.type !== 'mine') {
            socket.emit('buildError', 'Too far from base!');
            return;
        }

        // Check resource for dril
        if (data.type === 'dril') {
            const onResource = currentLobby.resourcePoints.some(rp =>
                Math.sqrt((data.x - rp.x)**2 + (data.y - rp.y)**2) < rp.radius + 25
            );
            if (!onResource) {
                socket.emit('buildError', 'Place on resource!');
                return;
            }
        }

        // Check collision with other buildings
        for (const b of Object.values(currentLobby.buildings)) {
            if (Math.abs(data.x - b.x) < 35 && Math.abs(data.y - b.y) < 35) {
                socket.emit('buildError', 'Blocked!');
                return;
            }
        }

        // Deduct money
        p.money -= cost;

        const building = {
            id: 'build_'+Date.now()+Math.random(),
            type: data.type,
            x: data.x, y: data.y,
            hp: data.type==='wall'?150:(data.type==='turret'?80:100),
            maxHp: data.type==='wall'?150:(data.type==='turret'?80:100),
            ownerId: socket.id,
            shootCooldown: 0
        };

        currentLobby.buildings[building.id] = building;
        io.to(currentLobby.code).emit('buildingCreated', building);
    });

    socket.on('disconnect', () => {
        if (currentLobby && currentLobby.players[socket.id]) {
            delete currentLobby.players[socket.id];
            io.to(currentLobby.code).emit('playerLeft', socket.id);

            if (Object.keys(currentLobby.players).length === 0) {
                lobbies.delete(currentLobby.code);
            } else if (currentLobby.creatorId === socket.id) {
                currentLobby.creatorId = Object.keys(currentLobby.players)[0];
                io.to(currentLobby.code).emit('newCreator', currentLobby.creatorId);
            }

            io.to(currentLobby.code).emit('lobbyUpdate', getLobbyInfo(currentLobby));
        }
    });
});

function getLobbyInfo(lobby) {
    return {
        code: lobby.code,
        players: Object.values(lobby.players).map(p => ({ id: p.id, nickname: p.nickname })),
        status: lobby.status,
        creatorId: lobby.creatorId
    };
}

// ============================================
// GAME LOOPS
// ============================================

setInterval(() => {
    lobbies.forEach(lobby => {
        if (lobby.status !== 'playing') return;
        if (Object.keys(lobby.players).length === 0) { lobby.status = 'paused'; return; }

        lobby.nextWaveTime--;
        if (lobby.nextWaveTime <= 0) { startWave(lobby); lobby.nextWaveTime = CONFIG.WAVE_DELAY; }
        io.to(lobby.code).emit('timer', { nextWaveTime: lobby.nextWaveTime, waveNumber: lobby.waveNumber });
    });
}, 1000);

setInterval(() => {
    lobbies.forEach(lobby => {
        if (lobby.status !== 'playing') return;

        // Passive income
        Object.values(lobby.players).forEach(p => {
            if (p.hp > 0) {
                p.incomeTimer = (p.incomeTimer || 0) + 1;
                if (p.incomeTimer >= 10) { p.incomeTimer = 0; p.money += CONFIG.PASSIVE_INCOME; }
            }
        });

        // Command Center laser
        const cc = lobby.buildings['cc'];
        cc.shootCooldown = Math.max(0, cc.shootCooldown - 1);
        if (cc.shootCooldown <= 0) {
            const target = lobby.monsters.find(m => Math.sqrt((m.x-cc.x)**2 + (m.y-cc.y)**2) < 300);
            if (target) {
                cc.shootCooldown = 12;
                const angle = Math.atan2(target.y - cc.y, target.x - cc.x);
                lobby.bullets.push({
                    id: 'laser_'+Date.now()+Math.random(),
                    x: cc.x, y: cc.y, angle, speed: 20,
                    ownerId: 'cc', damage: 40, life: 15, type: 'laser'
                });
                io.to(lobby.code).emit('bulletCreated', lobby.bullets[lobby.bullets.length-1]);
            }
        }

        // Turrets
        Object.values(lobby.buildings).filter(b => b.type === 'turret').forEach(t => {
            t.shootCooldown = Math.max(0, t.shootCooldown - 1);
            if (t.shootCooldown <= 0) {
                const target = lobby.monsters.find(m => Math.sqrt((m.x-t.x)**2 + (m.y-t.y)**2) < 250);
                if (target) {
                    t.shootCooldown = 25;
                    const angle = Math.atan2(target.y - t.y, target.x - t.x);
                    lobby.bullets.push({
                        id: 'turret_'+Date.now()+Math.random(),
                        x: t.x, y: t.y, angle, speed: 10,
                        ownerId: t.ownerId, damage: 15, life: 30, type: 'turret'
                    });
                    io.to(lobby.code).emit('bulletCreated', lobby.bullets[lobby.bullets.length-1]);
                }
            }
        });

        // Resource buildings
        Object.values(lobby.buildings).filter(b => b.type === 'mine' || b.type === 'dril').forEach(b => {
            b.spawnTimer = (b.spawnTimer || 0) + 1;
            const rate = b.type === 'dril' ? 5 : 8;
            if (b.spawnTimer >= rate) {
                b.spawnTimer = 0;
                const income = b.type === 'dril' ? 15 : 5;
                const owner = lobby.players[b.ownerId];
                if (owner) owner.money += income;
                io.to(lobby.code).emit('resourceGenerated', { buildingId: b.id, amount: income });
            }
        });
    });
}, 50);

setInterval(() => {
    lobbies.forEach(lobby => {
        if (lobby.status !== 'playing') return;

        // Bullets
        for (let i = lobby.bullets.length - 1; i >= 0; i--) {
            const b = lobby.bullets[i];
            b.x += Math.cos(b.angle) * b.speed;
            b.y += Math.sin(b.angle) * b.speed;
            b.life--;

            if (b.life <= 0 || b.x < 0 || b.x > CONFIG.MAP_WIDTH || b.y < 0 || b.y > CONFIG.MAP_HEIGHT) {
                lobby.bullets.splice(i, 1);
                io.to(lobby.code).emit('bulletRemoved', b.id);
                continue;
            }

            // Monster hits
            for (let j = lobby.monsters.length - 1; j >= 0; j--) {
                const m = lobby.monsters[j];
                const dist = Math.sqrt((m.x-b.x)**2 + (m.y-b.y)**2);
                if (dist < (b.type === 'laser' ? 20 : 12)) {
                    m.hp -= b.damage;
                    lobby.bullets.splice(i, 1);
                    io.to(lobby.code).emit('bulletRemoved', b.id);

                    if (m.hp <= 0) {
                        const reward = m.type === 'strong' ? 15 : 8;
                        if (b.ownerId && lobby.players[b.ownerId]) lobby.players[b.ownerId].money += reward;
                        lobby.monsters.splice(j, 1);
                        io.to(lobby.code).emit('monsterRemoved', m.id);
                    }
                    break;
                }
            }
        }
    });
}, 50);

setInterval(() => {
    lobbies.forEach(lobby => {
        if (lobby.status !== 'playing') return;

        // Monsters
        lobby.monsters.forEach(m => {
            m.attackCooldown = Math.max(0, m.attackCooldown - 1);

            // Find target
            let target = null, minDist = Infinity;

            Object.values(lobby.players).forEach(p => {
                if (p.hp > 0) {
                    const d = Math.sqrt((p.x-m.x)**2 + (p.y-m.y)**2);
                    if (d < minDist) { minDist = d; target = p; }
                }
            });

            if (!target) {
                const cc = lobby.buildings['cc'];
                const d = Math.sqrt((cc.x-m.x)**2 + (cc.y-m.y)**2);
                if (d < 350) { minDist = d; target = cc; }
            }

            if (target) {
                const angle = Math.atan2(target.y - m.y, target.x - m.x);
                const attackDist = target.hp !== undefined ? 20 : 25;

                if (minDist > attackDist) {
                    let blocked = false;
                    for (const b of Object.values(lobby.buildings)) {
                        if (b.type === 'wall') {
                            if (Math.abs(m.x + Math.cos(angle)*m.speed - b.x) < 28 && Math.abs(m.y + Math.sin(angle)*m.speed - b.y) < 28) {
                                blocked = true;
                                b.hp -= 2;
                                if (b.hp <= 0) { delete lobby.buildings[b.id]; io.to(lobby.code).emit('buildingRemoved', b.id); }
                                break;
                            }
                        }
                    }
                    if (!blocked) { m.x += Math.cos(angle) * m.speed; m.y += Math.sin(angle) * m.speed; }
                } else if (m.attackCooldown <= 0) {
                    m.attackCooldown = 45;
                    target.hp -= m.damage;
                    if (target.hp <= 0) {
                        if (lobby.players[target.id]) {
                            lobby.players[target.id].hp = lobby.players[target.id].maxHp;
                            lobby.players[target.id].x = lobby.buildings['cc'].x + (Math.random()-0.5)*40;
                            lobby.players[target.id].y = lobby.buildings['cc'].y + (Math.random()-0.5)*40;
                            io.to(lobby.code).emit('playerRespawned', target.id);
                        } else if (target.type === 'command_center') {
                            target.hp = target.maxHp;
                        }
                    }
                }
            }
        });

        // Wall regen
        Object.values(lobby.buildings).filter(b => b.type === 'wall' && b.hp < b.maxHp).forEach(b => {
            b.hp = Math.min(b.maxHp, b.hp + 0.15);
        });

        // Sync
        io.to(lobby.code).emit('gameState', {
            players: lobby.players,
            buildings: Object.values(lobby.buildings),
            monsters: lobby.monsters,
            bullets: lobby.bullets,
            wave: lobby.waveNumber,
            status: lobby.status
        });
    });
}, 100);

function startWave(lobby) {
    lobby.waveNumber++;
    const spawners = Object.values(lobby.buildings).filter(b => b.type === 'spawner');
    if (!spawners.length) return;

    const playerCount = Object.keys(lobby.players).length;
    const count = CONFIG.BASE_MONSTERS + lobby.waveNumber * 2 + playerCount * CONFIG.MONSTERS_PER_PLAYER;

    io.to(lobby.code).emit('waveStart', { wave: lobby.waveNumber, monsterCount: count });

    for (let i = 0; i < count; i++) {
        const sp = spawners[Math.floor(Math.random() * spawners.length)];
        setTimeout(() => {
            const type = lobby.waveNumber >= 3 && Math.random() > 0.7 ? 'strong' : 'basic';
            lobby.monsters.push({
                id: 'm_'+Date.now()+Math.random(),
                type, x: sp.x + (Math.random()-0.5)*30, y: sp.y + (Math.random()-0.5)*30,
                hp: type==='basic'?20:50, maxHp: type==='basic'?20:50,
                speed: type==='basic'?1.8:1.2,
                damage: type==='basic'?6:12,
                attackCooldown: 0
            });
            io.to(lobby.code).emit('monsterCreated', lobby.monsters[lobby.monsters.length-1]);
        }, i * 250);
    }
}

// ============================================
// START
// ============================================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server: ${PORT}`));