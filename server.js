const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// GAME CONFIG
// ============================================

const CONFIG = {
    MAP_WIDTH: 3000,
    MAP_HEIGHT: 3000,
    PLAYER_RADIUS: 15,
    PLAYER_SPEED: 5,
    RESOURCE_COUNT: 25,
    SPAWNER_COUNT: 8,
    BUILD_HITBOXES: {
        wall: { w: 40, h: 40 },
        turret: { w: 30, h: 30 },
        dril: { w: 40, h: 40 },
        mine: { w: 24, h: 24 },
        spawner: { w: 40, h: 40 },
        command_center: { w: 80, h: 80 }
    },
    BUILD_COSTS: {
        wall: 50,
        turret: 100,
        dril: 150,
        mine: 75
    },
    BUILD_RANGE: 150,
    WAVE_DELAY: 180
};

// ============================================
// GAME STATE
// ============================================

let gameState = {
    status: 'waiting', // waiting, playing, paused
    waveNumber: 0,
    nextWaveTime: CONFIG.WAVE_DELAY,
    players: {},
    buildings: {},
    monsters: [],
    bullets: [],
    resourcePoints: [],
    commandCenter: null
};

let creatorId = null;

// ============================================
// INITIALIZATION
// ============================================

function generateResourcePoints() {
    gameState.resourcePoints = [];
    for (let i = 0; i < CONFIG.RESOURCE_COUNT; i++) {
        gameState.resourcePoints.push({
            id: i,
            x: 300 + Math.random() * (CONFIG.MAP_WIDTH - 600),
            y: 300 + Math.random() * (CONFIG.MAP_HEIGHT - 600),
            radius: 35
        });
    }
}

function createCommandCenter() {
    const id = 'command_center';
    gameState.commandCenter = {
        id,
        type: 'command_center',
        x: CONFIG.MAP_WIDTH / 2,
        y: CONFIG.MAP_HEIGHT / 2,
        hp: 2000,
        maxHp: 2000,
        shootCooldown: 0,
        laserAngle: 0
    };
    gameState.buildings[id] = gameState.commandCenter;
}

function createSpawners() {
    for (let i = 0; i < CONFIG.SPAWNER_COUNT; i++) {
        const x = 200 + Math.random() * (CONFIG.MAP_WIDTH - 400);
        const y = 200 + Math.random() * (CONFIG.MAP_HEIGHT - 400);

        if (Math.abs(x - CONFIG.MAP_WIDTH/2) < 200 && Math.abs(y - CONFIG.MAP_HEIGHT/2) < 200) {
            continue;
        }

        const id = 'spawner_' + Date.now() + '_' + i;
        gameState.buildings[id] = {
            id,
            type: 'spawner',
            x,
            y,
            hp: 500,
            maxHp: 500
        };
    }
}

function resetGame() {
    gameState.status = 'waiting';
    gameState.waveNumber = 0;
    gameState.nextWaveTime = CONFIG.WAVE_DELAY;
    gameState.players = {};
    gameState.buildings = {};
    gameState.monsters = [];
    gameState.bullets = [];
    creatorId = null;

    generateResourcePoints();
    createCommandCenter();
    createSpawners();
}

resetGame();

// ============================================
// SOCKET HANDLERS
// ============================================

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    socket.on('getGameState', () => {
        socket.emit('gameStatus', {
            status: gameState.status,
            waveNumber: gameState.waveNumber,
            nextWaveTime: gameState.nextWaveTime,
            creatorId: creatorId,
            playerCount: Object.keys(gameState.players).length
        });

        if (gameState.status !== 'waiting') {
            socket.emit('init', {
                id: socket.id,
                mapWidth: CONFIG.MAP_WIDTH,
                mapHeight: CONFIG.MAP_HEIGHT,
                resourcePoints: gameState.resourcePoints,
                buildingHitboxes: CONFIG.BUILD_HITBOXES,
                playerRadius: CONFIG.PLAYER_RADIUS
            });
        }
    });

    socket.on('createGame', (nickname) => {
        if (Object.keys(gameState.players).length === 0) {
            creatorId = socket.id;
            addPlayer(socket.id, nickname);
            gameState.status = 'playing';
            io.emit('gameStarted');
        }
    });

    socket.on('join', (nickname) => {
        if (gameState.status === 'playing' || gameState.status === 'waiting') {
            addPlayer(socket.id, nickname);

            if (!creatorId && Object.keys(gameState.players).length === 1) {
                creatorId = socket.id;
            }
        }
    });

    socket.on('startGame', () => {
        if (socket.id === creatorId && gameState.status === 'waiting') {
            if (Object.keys(gameState.players).length > 0) {
                gameState.status = 'playing';
                io.emit('gameStarted');
            }
        }
    });

    socket.on('leaveGame', () => {
        removePlayer(socket.id);
    });

    socket.on('move', (data) => {
        const player = gameState.players[socket.id];
        if (!player || player.hp <= 0) return;

        player.x = Math.max(CONFIG.PLAYER_RADIUS, Math.min(CONFIG.MAP_WIDTH - CONFIG.PLAYER_RADIUS, data.x));
        player.y = Math.max(CONFIG.PLAYER_RADIUS, Math.min(CONFIG.MAP_HEIGHT - CONFIG.PLAYER_RADIUS, data.y));
        player.angle = data.angle || 0;
    });

    socket.on('shoot', (data) => {
        const player = gameState.players[socket.id];
        if (!player || player.hp <= 0 || player.weapon !== 'gun') return;
        if (player.ammo <= 0) return;

        player.ammo--;

        const bullet = {
            id: 'bullet_' + Date.now() + '_' + Math.random(),
            x: player.x,
            y: player.y,
            angle: data.angle,
            speed: 15,
            ownerId: socket.id,
            damage: 30,
            life: 50,
            type: 'player'
        };

        gameState.bullets.push(bullet);
        io.emit('bulletCreated', bullet);
    });

    socket.on('build', (data) => {
        const player = gameState.players[socket.id];
        if (!player || player.hp <= 0) return;

        const cost = CONFIG.BUILD_COSTS[data.type];
        if (!cost || player.money < cost) return;

        if (data.type !== 'mine' && data.type !== 'dril') {
            let nearBuilding = false;
            for (const b of Object.values(gameState.buildings)) {
                const dist = Math.sqrt(Math.pow(data.x - b.x, 2) + Math.pow(data.y - b.y, 2));
                if (dist < CONFIG.BUILD_RANGE) {
                    nearBuilding = true;
                    break;
                }
            }
            if (!nearBuilding) {
                socket.emit('buildError', 'Too far from base! Build near existing buildings.');
                return;
            }
        }

        if (data.type === 'dril') {
            const nearResource = gameState.resourcePoints.find(rp => {
                const dx = rp.x - data.x;
                const dy = rp.y - data.y;
                return Math.sqrt(dx * dx + dy * dy) < rp.radius + 40;
            });
            if (!nearResource) {
                socket.emit('buildError', 'Dril must be on resource point!');
                return;
            }
        }

        for (const existing of Object.values(gameState.buildings)) {
            const dx = Math.abs(data.x - existing.x);
            const dy = Math.abs(data.y - existing.y);
            const minDist = 45;
            if (dx < minDist && dy < minDist) {
                socket.emit('buildError', 'Too close to another building!');
                return;
            }
        }

        player.money -= cost;

        const building = {
            id: 'build_' + Date.now() + '_' + Math.random(),
            type: data.type,
            x: data.x,
            y: data.y,
            hp: data.type === 'wall' ? 200 : (data.type === 'turret' ? 100 : 150),
            maxHp: data.type === 'wall' ? 200 : (data.type === 'turret' ? 100 : 150),
            ownerId: socket.id,
            shootCooldown: 0
        };

        gameState.buildings[building.id] = building;
        io.emit('buildingCreated', building);
    });

    socket.on('disconnect', () => {
        removePlayer(socket.id);
    });
});

function addPlayer(id, nickname) {
    const spawnPoint = gameState.commandCenter || { x: CONFIG.MAP_WIDTH/2, y: CONFIG.MAP_HEIGHT/2 };

    gameState.players[id] = {
        id,
        nickname: nickname || 'Player',
        x: spawnPoint.x + (Math.random() - 0.5) * 60,
        y: spawnPoint.y + (Math.random() - 0.5) * 60,
        hp: 100,
        maxHp: 100,
        money: 150,
        ammo: 50,
        weapon: 'gun',
        angle: 0,
        speed: CONFIG.PLAYER_SPEED
    };

    io.emit('playerJoined', gameState.players[id]);
}

function removePlayer(id) {
    if (gameState.players[id]) {
        delete gameState.players[id];
        io.emit('playerLeft', id);

        if (Object.keys(gameState.players).length === 0) {
            gameState.status = 'paused';
        } else if (id === creatorId) {
            creatorId = Object.keys(gameState.players)[0];
            io.emit('newCreator', creatorId);
        }
    }
}

// ============================================
// GAME LOOPS
// ============================================

function spawnMonster(x, y, type = 'basic') {
    const monster = {
        id: 'monster_' + Date.now() + '_' + Math.random(),
        type,
        x,
        y,
        hp: type === 'basic' ? 30 : 80,
        maxHp: type === 'basic' ? 30 : 80,
        speed: type === 'basic' ? 2 : 1.2,
        damage: type === 'basic' ? 8 : 15,
        attackCooldown: 0
    };
    gameState.monsters.push(monster);
    io.emit('monsterCreated', monster);
}

function startWave() {
    gameState.waveNumber++;
    const spawnerCount = Object.values(gameState.buildings).filter(b => b.type === 'spawner').length;
    const monsterCount = gameState.waveNumber * 4 + spawnerCount * 2;

    io.emit('waveStart', { wave: gameState.waveNumber, monsterCount });

    const spawners = Object.values(gameState.buildings).filter(b => b.type === 'spawner');
    if (spawners.length === 0) return;

    for (let i = 0; i < monsterCount; i++) {
        const spawner = spawners[Math.floor(Math.random() * spawners.length)];
        setTimeout(() => {
            spawnMonster(
                spawner.x + (Math.random() - 0.5) * 60,
                spawner.y + (Math.random() - 0.5) * 60,
                gameState.waveNumber >= 3 && Math.random() > 0.6 ? 'strong' : 'basic'
            );
        }, i * 400);
    }
}

// Timer loop
setInterval(() => {
    if (gameState.status !== 'playing') return;

    gameState.nextWaveTime--;

    if (gameState.nextWaveTime <= 0) {
        startWave();
        gameState.nextWaveTime = CONFIG.WAVE_DELAY + gameState.waveNumber * 30;
    }

    io.emit('timer', { nextWaveTime: gameState.nextWaveTime, waveNumber: gameState.waveNumber });
}, 1000);

// Buildings loop
setInterval(() => {
    if (gameState.status !== 'playing') return;

    for (const building of Object.values(gameState.buildings)) {
        if (building.type === 'mine' || building.type === 'dril') {
            building.spawnTimer = (building.spawnTimer || 0) + 1;
            const rate = building.type === 'dril' ? 5 : 10;
            if (building.spawnTimer >= rate) {
                building.spawnTimer = 0;
                const income = building.type === 'dril' ? 30 : 8;
                const owner = gameState.players[building.ownerId];
                if (owner) {
                    owner.money += income;
                }
                io.emit('resourceGenerated', { buildingId: building.id, amount: income });
            }
        }

        if (building.type === 'turret') {
            building.shootCooldown = Math.max(0, building.shootCooldown - 1);
            if (building.shootCooldown <= 0) {
                const target = gameState.monsters.find(m => {
                    const dx = m.x - building.x;
                    const dy = m.y - building.y;
                    return Math.sqrt(dx * dx + dy * dy) < 350;
                });
                if (target) {
                    building.shootCooldown = 25;
                    const bullet = {
                        id: 'turret_' + Date.now() + '_' + Math.random(),
                        x: building.x,
                        y: building.y,
                        angle: Math.atan2(target.y - building.y, target.x - building.x),
                        speed: 12,
                        ownerId: building.ownerId,
                        damage: 20,
                        life: 35,
                        type: 'turret'
                    };
                    gameState.bullets.push(bullet);
                    io.emit('bulletCreated', bullet);
                }
            }
        }

        if (building.type === 'command_center') {
            building.shootCooldown = Math.max(0, building.shootCooldown - 1);
            building.laserAngle = (building.laserAngle || 0) + 0.05;

            if (building.shootCooldown <= 0) {
                const target = gameState.monsters.find(m => {
                    const dx = m.x - building.x;
                    const dy = m.y - building.y;
                    return Math.sqrt(dx * dx + dy * dy) < 400;
                });
                if (target) {
                    building.shootCooldown = 8;

                    gameState.bullets.push({
                        id: 'laser_' + Date.now() + '_' + Math.random(),
                        x: building.x,
                        y: building.y,
                        angle: Math.atan2(target.y - building.y, target.x - building.x),
                        speed: 25,
                        ownerId: 'command_center',
                        damage: 50,
                        life: 20,
                        type: 'laser',
                        targetId: target.id
                    });
                    io.emit('bulletCreated', gameState.bullets[gameState.bullets.length - 1]);
                }
            }
        }
    }
}, 50);

// Bullets loop
setInterval(() => {
    if (gameState.status !== 'playing') return;

    for (let i = gameState.bullets.length - 1; i >= 0; i--) {
        const b = gameState.bullets[i];
        b.x += Math.cos(b.angle) * b.speed;
        b.y += Math.sin(b.angle) * b.speed;
        b.life--;

        if (b.life <= 0 || b.x < 0 || b.x > CONFIG.MAP_WIDTH || b.y < 0 || b.y > CONFIG.MAP_HEIGHT) {
            gameState.bullets.splice(i, 1);
            io.emit('bulletRemoved', b.id);
            continue;
        }

        for (let j = gameState.monsters.length - 1; j >= 0; j--) {
            const m = gameState.monsters[j];
            const hitRadius = b.type === 'laser' ? 30 : 18;
            if (Math.sqrt(Math.pow(m.x - b.x, 2) + Math.pow(m.y - b.y, 2)) < hitRadius) {
                m.hp -= b.damage;
                gameState.bullets.splice(i, 1);
                io.emit('bulletRemoved', b.id);

                if (m.hp <= 0) {
                    const reward = m.type === 'strong' ? 25 : 15;
                    if (b.ownerId && gameState.players[b.ownerId]) {
                        gameState.players[b.ownerId].money += reward;
                    } else if (b.ownerId === 'command_center') {
                        Object.values(gameState.players).forEach(p => p.money += reward);
                    }
                    gameState.monsters.splice(j, 1);
                    io.emit('monsterRemoved', m.id);
                }
                break;
            }
        }
    }
}, 50);

// Monsters loop
setInterval(() => {
    if (gameState.status !== 'playing') return;

    for (const monster of gameState.monsters) {
        monster.attackCooldown = Math.max(0, monster.attackCooldown - 1);

        let target = null;
        let minDist = Infinity;

        for (const p of Object.values(gameState.players)) {
            if (p.hp > 0) {
                const dist = Math.sqrt(Math.pow(p.x - monster.x, 2) + Math.pow(p.y - monster.y, 2));
                if (dist < minDist) {
                    minDist = dist;
                    target = p;
                }
            }
        }

        if (!target) {
            const cc = gameState.commandCenter;
            if (cc) {
                const dist = Math.sqrt(Math.pow(cc.x - monster.x, 2) + Math.pow(cc.y - monster.y, 2));
                if (dist < 500) {
                    minDist = dist;
                    target = cc;
                }
            }
        }

        for (const b of Object.values(gameState.buildings)) {
            if (b.type === 'wall') {
                const dist = Math.sqrt(Math.pow(b.x - monster.x, 2) + Math.pow(b.y - monster.y, 2));
                if (dist < minDist && dist < 400) {
                    minDist = dist;
                    target = b;
                }
            }
        }

        if (target) {
            const angle = Math.atan2(target.y - monster.y, target.x - monster.x);
            const attackDist = target.hp !== undefined ? 25 : 35;

            if (minDist > attackDist) {
                let newX = monster.x + Math.cos(angle) * monster.speed;
                let newY = monster.y + Math.sin(angle) * monster.speed;

                let blocked = false;
                for (const b of Object.values(gameState.buildings)) {
                    if (b.type === 'wall') {
                        if (Math.abs(newX - b.x) < 32 && Math.abs(newY - b.y) < 32) {
                            blocked = true;
                            b.hp -= 3;
                            if (b.hp <= 0) {
                                delete gameState.buildings[b.id];
                                io.emit('buildingRemoved', b.id);
                            }
                            break;
                        }
                    }
                }

                if (!blocked) {
                    monster.x = newX;
                    monster.y = newY;
                }
            } else if (monster.attackCooldown <= 0) {
                monster.attackCooldown = 50;
                target.hp -= monster.damage;

                if (target.hp <= 0) {
                    if (gameState.players[target.id]) {
                        gameState.players[target.id].hp = target.maxHp;
                        gameState.players[target.id].x = gameState.commandCenter.x + (Math.random() - 0.5) * 60;
                        gameState.players[target.id].y = gameState.commandCenter.y + (Math.random() - 0.5) * 60;
                        io.emit('playerRespawned', target.id);
                    } else if (target.type === 'command_center') {
                        target.hp = target.maxHp;
                    }
                }
            }
        }
    }
}, 50);

// Wall regeneration
setInterval(() => {
    for (const b of Object.values(gameState.buildings)) {
        if (b.type === 'wall' && b.hp < b.maxHp) {
            b.hp = Math.min(b.maxHp, b.hp + 0.3);
        }
    }
}, 100);

// Sync loop
setInterval(() => {
    const sendState = {
        players: gameState.players,
        buildings: Object.values(gameState.buildings),
        monsters: gameState.monsters,
        bullets: gameState.bullets,
        wave: gameState.waveNumber,
        nextWaveTime: gameState.nextWaveTime,
        status: gameState.status
    };
    io.emit('gameState', sendState);
}, 100);

// ============================================
// START SERVER
// ============================================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});