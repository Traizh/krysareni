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
const ALLOWED = new Set(['index.html', 'shared.js', 'config.js', 'three.module.min.js']);
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

const KNIFE_TEXTS = [
  (k, v) => `${k} podřízl ${v} jako sýr`,
  (k, v) => `${k} nakrájel ${v} na plátky`,
  (k, v) => `${k} podrazil ${v} nožem`,
  (k, v) => `${k} zapíchl ${v} jako špekáček`,
];
const KILL_TEXTS = [
  (k, v) => `${k} udělal z ${v} ementál`,
  (k, v) => `${k} prostřelil ${v} jako sýr`,
  (k, v) => `${k} poslal ${v} do kočičího nebe`,
  (k, v) => `${k} nakrmil ${v} olovem`,
  (k, v) => `${k} naučil ${v} létat`,
  (k, v) => `${v} dostal od ${k} pořádnou dávku`,
  (k, v) => `${k} ukázal ${v}, kdo je tu největší krysa`,
  (k, v) => `${k} vyřídil ${v} jako profík`,
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
    this.hist = [];
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
      score: 0, deaths: 0, cool: 0, mcool: 0, weapon: 0, ammo: -1, fast: 0, hit: 0, lastSq: 0,
      input: { dx: 0, dy: 0, a: 0, s: false, m: false, sp: false, spT: 0, pitch: 0, vt: 0, rt: 0 },
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
    p.weapon = 0; p.ammo = -1; p.fast = 0; p.hit = 0; p.cool = 0.5;
  }

  kill(victim, killer, how) {
    victim.alive = false; victim.deaths++;
    victim.respawnAt = Date.now() + 2500;
    killer.score++;
    killer.hp = Math.min(S.MAX_HP, killer.hp + 25);
    this.broadcast({
      t: 'ev', k: 'kill', k1: killer.id, v: victim.id, x: Math.round(victim.x), y: Math.round(victim.y),
      text: pick(how === 'knife' ? KNIFE_TEXTS : KILL_TEXTS)(killer.name, victim.name),
    });
    if (killer.score >= WIN_SCORE) {
      this.broadcast({ t: 'ev', k: 'win', text: `${killer.name} vyhrál sýrovou válku! 🧀👑` });
      for (const p of this.players.values()) { p.score = 0; p.deaths = 0; }
    }
  }

  rewind(vt) {
    const h = this.hist;
    if (h.length < 2) return null;
    if (vt >= h[h.length - 1].T) return h[h.length - 1].p;
    if (vt <= h[0].T) return h[0].p;
    for (let i = h.length - 1; i > 0; i--) {
      if (h[i - 1].T <= vt) {
        const a = h[i - 1], b = h[i], f = (vt - a.T) / Math.max(1, b.T - a.T), out = {};
        for (const id in b.p) {
          const pa = a.p[id], pb = b.p[id];
          out[id] = pa ? [pa[0] + (pb[0] - pa[0]) * f, pa[1] + (pb[1] - pa[1]) * f, pb[2]] : pb;
        }
        return out;
      }
    }
    return null;
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
    p.input.m = td < 50;
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
      p.mcool -= dt;
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

      if (inp.m && p.mcool <= 0) {
        p.mcool = 0.6;
        this.broadcast({ t: 'ev', k: 'stab', id: p.id });
        let best = null, bd = 1e9;
        for (const o of this.players.values()) {
          if (o === p || !o.alive) continue;
          const ddx = o.x - p.x, ddy = o.y - p.y, d = Math.hypot(ddx, ddy);
          if (d > 64) continue;
          let da = Math.atan2(ddy, ddx) - p.a; da = Math.atan2(Math.sin(da), Math.cos(da));
          if (Math.abs(da) > 0.95 || d >= bd) continue;
          best = o; bd = d;
        }
        if (best) {
          let ba = best.a - p.a; ba = Math.atan2(Math.sin(ba), Math.cos(ba));
          best.hp -= Math.abs(ba) < 1.2 ? 100 : 55;   // zezadu = okamžitá smrt
          best.hit = 0.2;
          if (best.hp <= 0) this.kill(best, p, 'knife');
        }
      }
      const wantShot = inp.s || (inp.sp && now - inp.spT < 150);
      if (wantShot && p.cool <= 0) {
        // Hitscan s kompenzací lagu: cíle se "přetočí" na místo, kam se střelec díval.
        inp.sp = false;
        const w = S.WEAPONS[p.weapon];
        p.cool = w.cd;
        const h0 = S.EYE, slope = Math.tan(Math.max(-1.4, Math.min(1.4, inp.pitch || 0)));
        const m = S.muzzle(p.x, p.y, p.a);
        const vt0 = inp.vt ? inp.vt + (now - inp.rt) : now;
        const rew = this.rewind(Math.min(now, Math.max(vt0, now - 400)));
        const ends = [];
        let landed = 0, killed = false;
        for (let i = 0; i < w.pellets; i++) {
          const ang = p.a + (Math.random() * 2 - 1) * w.spread;
          let bt = S.rayWall(p.x, p.y, ang, 2600, h0, slope), best = null;
          for (const o of this.players.values()) {
            if (!o.alive || o === p) continue;
            const rp = rew && rew[o.id];
            const ex = rp ? rp[0] : o.x, ey = rp ? rp[1] : o.y, ef = rp ? rp[2] : o.a;
            // hitbox sedí na model: tělo + hlava, ocas se nepočítá (střed posunutý dopředu)
            const t = S.rayEllipse(p.x, p.y, ang, ex + Math.cos(ef) * 7, ey + Math.sin(ef) * 7, ef, 28, 16);
            if (t === null || t >= bt) continue;
            const hh = h0 + slope * t;
            if (hh >= 0 && hh <= S.RAT_H) { bt = t; best = o; }
          }
          ends.push([Math.round(p.x + Math.cos(ang) * bt), Math.round(p.y + Math.sin(ang) * bt), Math.max(0, Math.round(h0 + slope * bt))]);
          if (best && best.alive) {
            landed++; best.hp -= w.dmg; best.hit = 0.15;
            if (best.hp <= 0) { this.kill(best, p); killed = true; }
          }
        }
        this.broadcast({ t: 'ev', k: 'shot', o: p.id, w: p.weapon, x: Math.round(m.x), y: Math.round(m.y), e: ends });
        if (landed) this.send(p, { t: 'ev', k: 'hm', kl: killed ? 1 : 0 });
        if (p.ammo > 0) { p.ammo--; if (p.ammo === 0) { p.weapon = 0; p.ammo = -1; } }
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

    // střely (po podkrocích, rychlé kulky nesmí proletět krysou)
    const keep = [];
    for (const b of this.bullets) {
      const steps = Math.max(1, Math.ceil((b.sp * dt) / 12));
      const sd = dt / steps;
      let dead = false;
      for (let i = 0; i < steps && !dead; i++) {
        b.x += Math.cos(b.a) * b.sp * sd;
        b.y += Math.sin(b.a) * b.sp * sd;
        if (S.pointBlocked(b.x, b.y)) { dead = true; break; }
        for (const p of this.players.values()) {
          if (!p.alive || p.id === b.o) continue;
          if (Math.hypot(p.x - b.x, p.y - b.y) < R + 4) {
            p.hp -= b.dmg; p.hit = 0.15; dead = true;
            if (p.hp <= 0) {
              const killer = this.players.get(b.o);
              if (killer) this.kill(p, killer);
              else { p.alive = false; p.deaths++; p.respawnAt = now + 2500; }
            }
            break;
          }
        }
      }
      b.life -= dt;
      if (!dead && b.life > 0) keep.push(b);
    }
    this.bullets = keep;

    // bonusy
    this.pickT -= dt;
    if (this.pickT <= 0 && this.pickups.length < 6) {
      this.pickT = 5;
      for (let tries = 0; tries < 10; tries++) {
        const x = rnd(80, S.W - 80), y = rnd(80, S.H - 80);
        const c = S.collide(x, y, 26);
        if (Math.hypot(c.x - x, c.y - y) < 0.5) {
          this.pickups.push({ id: this.nextBullet++, kind: Math.floor(rnd(0, 5)), x: Math.round(x), y: Math.round(y) });
          break;
        }
      }
    }
    this.pickups = this.pickups.filter((k) => {
      for (const p of this.players.values()) {
        if (!p.alive || Math.hypot(p.x - k.x, p.y - k.y) > R + 18) continue;
        if (k.kind === 0) p.hp = Math.min(S.MAX_HP, p.hp + 50);
        else if (k.kind === 4) p.fast = 8;
        else { p.weapon = k.kind; p.ammo = S.WEAPONS[k.kind].ammo; }
        this.broadcast({ t: 'ev', k: 'pick', id: p.id, kind: k.kind, x: k.x, y: k.y });
        return false;
      }
      return true;
    });

    const hp = {};
    for (const p of this.players.values()) hp[p.id] = [p.x, p.y, p.a];
    this.hist.push({ T: now, p: hp });
    if (this.hist.length > 30) this.hist.shift();

    // snapshot
    const ps = [];
    for (const p of this.players.values()) {
      ps.push([p.id, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.a * 100) / 100,
        Math.max(0, Math.round(p.hp)), p.alive ? 1 : 0,
        (p.fast > 0 ? 2 : 0) | (p.hit > 0 ? 4 : 0), p.score, p.deaths, p.weapon, p.ammo]);
    }
    const bs = this.bullets.map((b) => [b.id, Math.round(b.x), Math.round(b.y), Math.round(b.a * 100) / 100, b.o, b.w]);
    const ks = this.pickups.map((k) => [k.id, k.kind, k.x, k.y]);
    this.broadcast({ t: 's', T: now, p: ps, b: bs, k: ks });
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
      me.input.m = !!m.m;
      me.input.pitch = Math.max(-1.4, Math.min(1.4, num(m.p)));
      me.input.vt = num(m.vt, 0);
      me.input.rt = Date.now();
      if (m.s) { me.input.sp = true; me.input.spT = Date.now(); }
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
