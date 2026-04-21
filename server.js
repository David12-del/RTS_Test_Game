const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const MAP_WIDTH = 2000;
const MAP_HEIGHT = 2000;
const RESOURCE_COUNT = 15;

const PLAYER_RADIUS = 15;
const BUILD_HITBOXES = {
    wall: { w: 40, h: 40 },
    turret: { w: 30, h: 30 },
    dril: { w: 40, h: 40 },
    mine: { w: 24, h: 24 },
    spawner: { w: 40, h: 40 }
};

const players = {};
const buildings = {};
const monsters = [];
const resourcePoints = [];
const bullets = [];

let waveNumber = 0;
let waveTimer = null;
let nextWaveTime = 120;

function generateResourcePoints() {
    for (let i = 0; i < RESOURCE_COUNT; i++) {
        resourcePoints.push({
            id: i,
            x: Math.random() * MAP_WIDTH,
            y: Math.random() * MAP_HEIGHT,
            radius: 30
        });
    }
}

function createSpawner(x, y) {
    const id = 'spawner_' + Date.now();
    buildings[id] = {
        id,
        type: 'spawner',
        x,
        y,
        hp: 500,
        maxHp: 500,
        spawnTimer: 0,
        spawnRate: 10
    };
}

generateResourcePoints();

for (let i = 0; i < 5; i++) {
    createSpawner(
        200 + Math.random() * (MAP_WIDTH - 400),
        200 + Math.random() * (MAP_HEIGHT - 400)
    );
}

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    socket.on('join', (nickname) => {
        players[socket.id] = {
            id: socket.id,
            nickname: nickname || 'Player',
            x: Math.random() * MAP_WIDTH,
            y: Math.random() * MAP_HEIGHT,
            hp: 100,
            maxHp: 100,
            money: 100,
            angle: 0,
            speed: 5
        };

        socket.emit('init', {
            id: socket.id,
            mapWidth: MAP_WIDTH,
            mapHeight: MAP_HEIGHT,
            resourcePoints,
            buildingHitboxes: BUILD_HITBOXES,
            playerRadius: PLAYER_RADIUS
        });

        io.emit('playerJoined', players[socket.id]);
    });

    socket.on('move', (data) => {
        const player = players[socket.id];
        if (!player || player.hp <= 0) return;

        let newX = Math.max(PLAYER_RADIUS, Math.min(MAP_WIDTH - PLAYER_RADIUS, data.x));
        let newY = Math.max(PLAYER_RADIUS, Math.min(MAP_HEIGHT - PLAYER_RADIUS, data.y));

        const testX = { x: newX, y: player.y };
        const testY = { x: player.x, y: newY };

        if (!checkCollision(testX)) {
            player.x = newX;
        }
        if (!checkCollision(testY)) {
            player.y = newY;
        }

        player.angle = data.angle || 0;
    });

    function checkCollision(obj, extraRadius = 0) {
        const r = PLAYER_RADIUS + extraRadius;

        for (const b of Object.values(buildings)) {
            const bh = BUILD_HITBOXES[b.type];
            if (!bh) continue;

            const halfW = bh.w / 2 + r;
            const halfH = bh.h / 2 + r;

            if (Math.abs(obj.x - b.x) < halfW && Math.abs(obj.y - b.y) < halfH) {
                return true;
            }
        }

        return false;
    }

    socket.on('shoot', (data) => {
        const player = players[socket.id];
        if (!player || player.hp <= 0) return;

        if (player.money < 10) return;

        player.money -= 10;

        const bullet = {
            id: 'bullet_' + Date.now() + '_' + Math.random(),
            x: player.x,
            y: player.y,
            angle: data.angle,
            speed: 12,
            ownerId: socket.id,
            damage: 25,
            life: 60
        };

        bullets.push(bullet);
        io.emit('bulletCreated', bullet);
    });

    socket.on('build', (data) => {
        const player = players[socket.id];
        if (!player || player.hp <= 0) return;

        const costs = {
            wall: 50,
            turret: 100,
            dril: 150,
            mine: 75
        };

        const cost = costs[data.type];
        if (!cost || player.money < cost) return;

        const bh = BUILD_HITBOXES[data.type];
        if (!bh) return;

        const buildObj = { x: data.x, y: data.y };
        const buildRadius = Math.max(bh.w, bh.h) / 2;

        for (const existing of Object.values(buildings)) {
            const eh = BUILD_HITBOXES[existing.type];
            if (!eh) continue;

            const dx = Math.abs(buildObj.x - existing.x);
            const dy = Math.abs(buildObj.y - existing.y);
            const minDist = (bh.w / 2 + eh.w / 2) * 0.9;

            if (dx < minDist && dy < minDist) {
                socket.emit('buildError', 'Too close to another building!');
                return;
            }
        }

        if (data.type === 'dril') {
            const nearResource = resourcePoints.find(rp => {
                const dx = rp.x - data.x;
                const dy = rp.y - data.y;
                return Math.sqrt(dx * dx + dy * dy) < rp.radius + 30;
            });
            if (!nearResource) {
                socket.emit('buildError', 'Dril can only be placed on resource points!');
                return;
            }
        }

        const distToPlayer = Math.sqrt(
            Math.pow(data.x - player.x, 2) +
            Math.pow(data.y - player.y, 2)
        );
        if (distToPlayer < PLAYER_RADIUS + buildRadius + 20) {
            socket.emit('buildError', 'Too close to player!');
            return;
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

        buildings[building.id] = building;
        io.emit('buildingCreated', building);
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('playerLeft', socket.id);
    });
});

function spawnMonster(x, y, type = 'basic') {
    const monster = {
        id: 'monster_' + Date.now() + '_' + Math.random(),
        type,
        x,
        y,
        hp: type === 'basic' ? 30 : 60,
        maxHp: type === 'basic' ? 30 : 60,
        speed: type === 'basic' ? 2 : 1.5,
        damage: type === 'basic' ? 5 : 10,
        attackCooldown: 0,
        target: null
    };
    monsters.push(monster);
    io.emit('monsterCreated', monster);
}

function startWave() {
    waveNumber++;
    const spawnerCount = Object.keys(buildings).filter(b => buildings[b].type === 'spawner').length;
    const monsterCount = waveNumber * 3 + spawnerCount * 2;

    io.emit('waveStart', { wave: waveNumber, monsterCount });

    for (let i = 0; i < monsterCount; i++) {
        const spawners = Object.values(buildings).filter(b => b.type === 'spawner');
        if (spawners.length === 0) break;

        const spawner = spawners[Math.floor(Math.random() * spawners.length)];
        setTimeout(() => {
            spawnMonster(spawner.x + (Math.random() - 0.5) * 50, spawner.y + (Math.random() - 0.5) * 50,
                waveNumber >= 3 && Math.random() > 0.7 ? 'strong' : 'basic');
        }, i * 500);
    }
}

setInterval(() => {
    nextWaveTime--;
    if (nextWaveTime <= 0) {
        startWave();
        nextWaveTime = 180 + Math.random() * 120;
    }
    io.emit('timer', { nextWaveTime, waveNumber });
}, 1000);

setInterval(() => {
    Object.values(buildings).forEach(building => {
        if (building.type === 'mine' || building.type === 'dril') {
            building.spawnTimer = (building.spawnTimer || 0) + 1;
            const rate = building.type === 'dril' ? 5 : 10;
            if (building.spawnTimer >= rate) {
                building.spawnTimer = 0;
                const income = building.type === 'dril' ? 25 : 5;
                if (building.ownerId && players[building.ownerId]) {
                    players[building.ownerId].money += income;
                } else {
                    Object.values(players).forEach(p => {
                        p.money += income;
                    });
                }
                io.emit('resourceGenerated', { buildingId: building.id, amount: income });
            }
        }

        if (building.type === 'turret') {
            building.shootCooldown = Math.max(0, building.shootCooldown - 1);
            if (building.shootCooldown <= 0) {
                const target = monsters.find(m => {
                    const dx = m.x - building.x;
                    const dy = m.y - building.y;
                    return Math.sqrt(dx * dx + dy * dy) < 300;
                });
                if (target) {
                    building.shootCooldown = 30;
                    const bullet = {
                        id: 'turret_' + Date.now() + '_' + Math.random(),
                        x: building.x,
                        y: building.y,
                        angle: Math.atan2(target.y - building.y, target.x - building.x),
                        speed: 10,
                        ownerId: building.ownerId,
                        damage: 15,
                        life: 40,
                        isTurret: true
                    };
                    bullets.push(bullet);
                    io.emit('bulletCreated', bullet);
                }
            }
        }
    });
}, 100);

setInterval(() => {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += Math.cos(b.angle) * b.speed;
        b.y += Math.sin(b.angle) * b.speed;
        b.life--;

        if (b.life <= 0) {
            bullets.splice(i, 1);
            io.emit('bulletRemoved', b.id);
            continue;
        }

        for (let j = monsters.length - 1; j >= 0; j--) {
            const m = monsters[j];
            const dx = m.x - b.x;
            const dy = m.y - b.y;
            if (Math.sqrt(dx * dx + dy * dy) < 20) {
                m.hp -= b.damage;
                bullets.splice(i, 1);
                io.emit('bulletRemoved', b.id);

                if (m.hp <= 0) {
                    const killerId = b.ownerId;
                    if (killerId && players[killerId]) {
                        players[killerId].money += 15;
                    }
                    monsters.splice(j, 1);
                    io.emit('monsterRemoved', m.id);
                }
                break;
            }
        }
    }
}, 50);

setInterval(() => {
    monsters.forEach(monster => {
        monster.attackCooldown = Math.max(0, monster.attackCooldown - 1);

        let target = null;
        let minDist = Infinity;

        Object.values(players).forEach(p => {
            if (p.hp > 0) {
                const dx = p.x - monster.x;
                const dy = p.y - monster.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < minDist) {
                    minDist = dist;
                    target = p;
                }
            }
        });

        Object.values(buildings).forEach(b => {
            if (b.type === 'wall') {
                const dx = b.x - monster.x;
                const dy = b.y - monster.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < minDist && dist < 400) {
                    minDist = dist;
                    target = b;
                }
            }
        });

        if (target) {
            const angle = Math.atan2(target.y - monster.y, target.x - monster.x);
            const attackDist = target.hp !== undefined ? 25 : 35;

            if (minDist > attackDist) {
                let newX = monster.x + Math.cos(angle) * monster.speed;
                let newY = monster.y + Math.sin(angle) * monster.speed;

                let blocked = false;
                for (const b of Object.values(buildings)) {
                    if (b.type === 'wall') {
                        const bh = BUILD_HITBOXES.wall;
                        if (Math.abs(newX - b.x) < bh.w / 2 + 12 &&
                            Math.abs(newY - b.y) < bh.h / 2 + 12) {
                            blocked = true;
                            b.hp -= 2;
                            if (b.hp <= 0) {
                                delete buildings[b.id];
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
                monster.attackCooldown = 60;
                if (target.hp !== undefined) {
                    target.hp -= monster.damage;
                    if (target.hp <= 0) {
                        if (players[target.id]) {
                            players[target.id].hp = target.maxHp;
                            players[target.id].x = Math.random() * MAP_WIDTH;
                            players[target.id].y = Math.random() * MAP_HEIGHT;
                            io.emit('playerRespawned', target.id);
                        }
                    }
                }
            }
        }
    });
}, 50);

setInterval(() => {
    Object.values(buildings).forEach(b => {
        if (b.type === 'wall' && b.hp < b.maxHp) {
            b.hp = Math.min(b.maxHp, b.hp + 0.5);
        }
    });
}, 100);

setInterval(() => {
    const gameState = {
        players,
        buildings: Object.values(buildings).filter(b => b.type !== 'spawner'),
        monsters,
        bullets,
        wave: waveNumber,
        nextWaveTime
    };
    io.emit('gameState', gameState);
}, 100);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});