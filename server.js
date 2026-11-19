// KRYSÍ KOLAPS – autoritativní multiplayer server (Node + ws).
// Běží na Renderu, zároveň servíruje složku /public (hra funguje i bez itch.io).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
// Funguje s hrou ve složce public/ i když jsou soubory nahrané rovnou v kořeni repa.
const PUB = fs.existsSync(path.join(__dirname, 'public', 'index.html')) ? path.join(__dirname, 'public') : __dirname;
const S = require(path.join(PUB, 'shared.js'));
const ALLOWED = new Set(['index.html', 'shared.js', 'config.js']);
const TICK = 30;
const MAX_HUMANS = 12;
const TARGET_PLAYERS = 4;   // kolik krys má být v aréně (zbytek dorovnají boti)
const WIN_SCORE = 15;
const BOT_NAMES = ['Sýrový Karel', 'Hnusná Hana', 'Ostrý Ondra', 'Krysák Bot', 'Tlustý Tonda', 'Lord Ementál'];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let pathname = '/';
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { /* ignore */ }
  if (pathname === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (pathname === '/') pathname = '/index.html';
  const file = path.normalize(path.join(PUB, pathname));
  if (!file.startsWith(PUB + path.sep) || !ALLOWED.has(path.basename(file)) || path.dirname(file) !== PUB) { res.writeHead(404); return res.end('Nenalezeno'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Nenalezeno'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, maxPayload: 1024 });

const rooms = new Map();
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const KILL_TEXTS = [
  (k, v) => `${k} zasypal ${v} sýrem`,
  (k, v) => `${k} nakrmil ${v} cheddarem`,
  (k, v) => `${k} poslal ${v} do kočičího nebe`,
  (k, v) => `${k} udělal z ${v} ementál`,
  (k, v) => `${k} zpacifikoval ${v} tvarůžkem`,
  (k, v) => `${k} naučil ${v} létat`,
  (k, v) => `${k} vtipně praštil ${v} gorgonzolou`,
  (k, v) => `${v} dostal od ${k} sýrovou sprchu`,
  (k, v) => `${k} ukázal ${v}, kdo je tu největší krysa`,
];

class Room {
  constructor(name) {
    this.name = name;
    this.players = new Map();
    this.bullets = [];
    this.pickups = [];
    this.nextId = 1;
    this.nextBullet = 1;
    this.pickT = 3;
    this.time = 0;
    this.timer = setInterval(() => this.tick(), 1000 / TICK);
  }

  humans() { let n = 0; for (const p of this.players.values()) if (!p.bot) n++; return n; }

  send(p, obj) {
    if (p.bot || !p.ws || p.ws.readyState !== 1) return;
    p.ws.send(JSON.stringify(obj));
  }

  broadcast(obj) {
    const s = JSON.stringify(obj);
    for (const p of this.players.values()) {
      if (p.bot || !p.ws || p.ws.readyState !== 1) continue;
      if (p.ws.bufferedAmount > 200000) continue;
      p.ws.send(s);
    }
  }

  roster() {
    const list = [];
    for (const p of this.players.values()) list.push({ id: p.id, n: p.name, h: p.hat, c: p.color, b: p.bot ? 1 : 0 });
    this.broadcast({ t: 'roster', list });
  }

  addPlayer(data) {
    const p = {
      id: this.nextId++, ws: data.ws || null, bot: !!data.bot,
      name: data.name, hat: data.hat, color: data.color,
      x: 0, y: 0, a: 0, hp: S.MAX_HP, alive: false, respawnAt: 0,
      score: 0, deaths: 0, cool: 0, rapid: 0, fast: 0, hit: 0, lastSq: 0,
      input: { dx: 0, dy: 0, a: 0, s: false },
      ai: { retarget: 0, dir: 0, jitter: 0, t: 0 },
    };
    this.players.set(p.id, p);
    this.spawn(p);
    return p;
  }

  removePlayer(id) { this.players.delete(id); }

  balanceBots() {
    const humans = this.humans();
    const want = Math.max(0, TARGET_PLAYERS - humans);
    const bots = [...this.players.values()].filter((p) => p.bot);
    let changed = false;
    while (bots.length < want) {
      const used = new Set(bots.map((b) => b.name));
      const name = BOT_NAMES.find((n) => !used.has(n)) || 'Bot ' + this.nextId;
      const b = this.addPlayer({ bot: true, name, hat: Math.floor(rnd(0, 6)), color: Math.floor(rnd(0, 8)) });
      bots.push(b); changed = true;
    }
    while (bots.length > want) { this.removePlayer(bots.pop().id); changed = true; }
    if (changed) this.roster();
  }

  spawn(p) {
    let best = S.SPAWNS[0], bestD = -1;
    for (const sp of S.SPAWNS) {
      let md = 1e9;
      for (const o of this.players.values()) {
        if (o === p || !o.alive) continue;
        md = Math.min(md, Math.hypot(o.x - sp[0], o.y - sp[1]));
      }
      md += Math.random() * 150;
      if (md > bestD) { bestD = md; best = sp; }
    }
    p.x = best[0]; p.y = best[1]; p.hp = S.MAX_HP; p.alive = true;
    p.rapid = 0; p.fast = 0; p.hit = 0; p.cool = 0.5;
  }

  kill(victim, killer) {
    victim.alive = false; victim.deaths++;
    victim.respawnAt = Date.now() + 2500;
    killer.score++;
    killer.hp = Math.min(S.MAX_HP, killer.hp + 25);
    this.broadcast({
      t: 'ev', k: 'kill', k1: killer.id, v: victim.id, x: Math.round(victim.x), y: Math.round(victim.y),
      text: pick(KILL_TEXTS)(killer.name, victim.name),
    });
    if (killer.score >= WIN_SCORE) {
      this.broadcast({ t: 'ev', k: 'win', text: `${killer.name} vyhrál sýrovou válku! 🧀👑` });
      for (const p of this.players.values()) { p.score = 0; p.deaths = 0; }
    }
  }

  botThink(p) {
    const ai = p.ai;
    ai.t += 1 / TICK;
    if (!p.alive) { p.input.s = false; return; }
    if (ai.t > ai.retarget) {
      ai.retarget = ai.t + rnd(0.6, 1.6);
      ai.dir = Math.random() < 0.5 ? 1 : -1;
      ai.jitter = rnd(-0.3, 0.3);
    }
    let target = null, td = 1e9;
    for (const o of this.players.values()) {
      if (o === p || !o.alive) continue;
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d < td) { td = d; target = o; }
    }
    if (!target) { p.input.dx = 0; p.input.dy = 0; p.input.s = false; return; }
    const ang = Math.atan2(target.y - p.y, target.x - p.x);
    let mx = 0, my = 0;
    if (td > 380) { mx = Math.cos(ang); my = Math.sin(ang); }
    else if (td < 200) { mx = -Math.cos(ang); my = -Math.sin(ang); }
    mx += Math.cos(ang + Math.PI / 2) * ai.dir * 0.8;
    my += Math.sin(ang + Math.PI / 2) * ai.dir * 0.8;
    p.input.dx = mx; p.input.dy = my;
    p.input.a = ang + ai.jitter;
    p.input.s = td < 600 && Math.random() < 0.7;
  }

  tick() {
    const dt = 1 / TICK;
    const now = Date.now();
    this.time += dt;
    const R = S.PR;

    for (const p of this.players.values()) {
      if (p.bot) this.botThink(p);
      if (!p.alive) { if (now >= p.respawnAt) this.spawn(p); continue; }
      p.cool -= dt;
      p.rapid = Math.max(0, p.rapid - dt);
      p.fast = Math.max(0, p.fast - dt);
      p.hit = Math.max(0, p.hit - dt);
      const inp = p.input;
      let dx = inp.dx, dy = inp.dy;
      const l = Math.hypot(dx, dy);
      if (l > 1) { dx /= l; dy /= l; }
      const sp = S.SPEED * (p.fast > 0 ? 1.6 : 1);
      p.x += dx * sp * dt; p.y += dy * sp * dt;
      p.a = inp.a;
      const c = S.collide(p.x, p.y, R); p.x = c.x; p.y = c.y;

      if (inp.s && p.cool <= 0) {
        p.cool = p.rapid > 0 ? 0.11 : 0.3;
        const m = S.muzzle(p.x, p.y, p.a);
        this.bullets.push({ id: this.nextBullet++, o: p.id, x: m.x, y: m.y, a: p.a, life: 1.3, dmg: 18 });
        if (this.bullets.length > 400) this.bullets.shift();
      }
    }

    // měkké odstrkování krys
    const arr = [...this.players.values()].filter((p) => p.alive);
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i], b = arr[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.01 && d < R * 2) {
          const push = (R * 2 - d) / 2; dx /= d; dy /= d;
          a.x -= dx * push; a.y -= dy * push; b.x += dx * push; b.y += dy * push;
        }
      }
    }
    for (const p of arr) { const c = S.collide(p.x, p.y, R); p.x = c.x; p.y = c.y; }

    // střely
    const keep = [];
    for (const b of this.bullets) {
      b.x += Math.cos(b.a) * S.BULLET_SPEED * dt;
      b.y += Math.sin(b.a) * S.BULLET_SPEED * dt;
      b.life -= dt;
      if (b.life <= 0 || S.pointBlocked(b.x, b.y)) continue;
      let hit = false;
      for (const p of this.players.values()) {
        if (!p.alive || p.id === b.o) continue;
        if (Math.hypot(p.x - b.x, p.y - b.y) < R + 5) {
          p.hp -= b.dmg; p.hit = 0.15; hit = true;
          if (p.hp <= 0) {
            const killer = this.players.get(b.o);
            if (killer) this.kill(p, killer);
            else { p.alive = false; p.deaths++; p.respawnAt = now + 2500; }
          }
          break;
        }
      }
      if (!hit) keep.push(b);
    }
    this.bullets = keep;

    // bonusy
    this.pickT -= dt;
    if (this.pickT <= 0 && this.pickups.length < 5) {
      this.pickT = 6;
      for (let tries = 0; tries < 10; tries++) {
        const x = rnd(80, S.W - 80), y = rnd(80, S.H - 80);
        const c = S.collide(x, y, 26);
        if (Math.hypot(c.x - x, c.y - y) < 0.5) {
          this.pickups.push({ id: this.nextBullet++, kind: Math.floor(rnd(0, 3)), x: Math.round(x), y: Math.round(y) });
          break;
        }
      }
    }
    this.pickups = this.pickups.filter((k) => {
      for (const p of this.players.values()) {
        if (!p.alive || Math.hypot(p.x - k.x, p.y - k.y) > R + 18) continue;
        if (k.kind === 0) p.hp = Math.min(S.MAX_HP, p.hp + 50);
        else if (k.kind === 1) p.rapid = 8;
        else p.fast = 8;
        this.broadcast({ t: 'ev', k: 'pick', id: p.id, kind: k.kind, x: k.x, y: k.y });
        return false;
      }
      return true;
    });

    // snapshot
    const ps = [];
    for (const p of this.players.values()) {
      ps.push([p.id, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.a * 100) / 100,
        Math.max(0, Math.round(p.hp)), p.alive ? 1 : 0,
        (p.rapid > 0 ? 1 : 0) | (p.fast > 0 ? 2 : 0) | (p.hit > 0 ? 4 : 0), p.score, p.deaths]);
    }
    const bs = this.bullets.map((b) => [b.id, Math.round(b.x), Math.round(b.y), Math.round(b.a * 100) / 100, b.o]);
    const ks = this.pickups.map((k) => [k.id, k.kind, k.x, k.y]);
    this.broadcast({ t: 's', p: ps, b: bs, k: ks });
  }

  destroy() { clearInterval(this.timer); }
}

function cleanName(s) {
  s = String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 14);
  return s || 'Krysa';
}
function cleanRoom(s) {
  s = String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 16);
  return s || 'hlavni';
}
const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);

wss.on('connection', (ws) => {
  let room = null, me = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;

    if (m.t === 'join' && !me) {
      const name = cleanRoom(m.room);
      let r = rooms.get(name);
      if (!r) { r = new Room(name); rooms.set(name, r); }
      if (r.humans() >= MAX_HUMANS) {
        ws.send(JSON.stringify({ t: 'full' }));
        if (r.humans() === 0) { r.destroy(); rooms.delete(name); }
        return ws.close();
      }
      room = r;
      me = r.addPlayer({
        ws, name: cleanName(m.name),
        hat: Math.max(0, Math.min(5, num(m.hat) | 0)),
        color: Math.max(0, Math.min(7, num(m.color) | 0)),
      });
      ws.send(JSON.stringify({ t: 'w', id: me.id, room: r.name }));
      r.balanceBots();
      r.roster();
      return;
    }
    if (!me || !room) return;

    if (m.t === 'in') {
      me.input.dx = Math.max(-1, Math.min(1, num(m.dx)));
      me.input.dy = Math.max(-1, Math.min(1, num(m.dy)));
      me.input.a = num(m.a, me.input.a);
      me.input.s = !!m.s;
    } else if (m.t === 'sq') {
      const now = Date.now();
      if (now - me.lastSq > 700 && me.alive) {
        me.lastSq = now;
        room.broadcast({ t: 'ev', k: 'sq', id: me.id, i: Math.floor(Math.random() * 12) });
      }
    }
  });

  ws.on('close', () => {
    if (!room || !me) return;
    room.removePlayer(me.id);
    if (room.humans() === 0) { room.destroy(); rooms.delete(room.name); }
    else { room.balanceBots(); room.roster(); }
  });
  ws.on('error', () => {});
});

// Ping, aby Render nezahodil spojení a mrtvé sockety zmizely.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) { /* ignore */ }
  }
}, 25000);

server.listen(PORT, () => console.log(`Krysí kolaps běží na portu ${PORT} 🐀🧀`));

module.exports = { server, wss, rooms };
