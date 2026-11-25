// Sdílená fyzika a mapa – používá server i klient (predikce pohybu).
(function () {
  const S = {};
  S.W = 1800;
  S.H = 1100;
  S.PR = 18;          // poloměr krysy
  S.SPEED = 230;      // px/s
  S.BULLET_SPEED = 650;
  S.MAX_HP = 100;

  // Zbraně: cd = rychlost střelby (s), pellets = počet projektilů, ammo -1 = nekonečno
  S.WEAPONS = [
    { name: 'Pistole', cd: 0.32, dmg: 20, pellets: 1, spread: 0.015, speed: 2400, life: 0.85, ammo: -1 },
    { name: 'Samopal', cd: 0.085, dmg: 9, pellets: 1, spread: 0.055, speed: 2300, life: 0.85, ammo: 60 },
    { name: 'Brokovnice', cd: 0.85, dmg: 11, pellets: 7, spread: 0.12, speed: 2000, life: 0.45, ammo: 14 },
    { name: 'Odstřelovačka', cd: 1.15, dmg: 75, pellets: 1, spread: 0.002, speed: 4500, life: 0.55, ammo: 8 },
  ];

  S.OBST = [
    { x: 330, y: 230, w: 180, h: 70, t: 'crate' },
    { x: 1290, y: 230, w: 180, h: 70, t: 'crate' },
    { x: 330, y: 800, w: 180, h: 70, t: 'crate' },
    { x: 1290, y: 800, w: 180, h: 70, t: 'crate' },
    { x: 790, y: 470, w: 220, h: 160, t: 'cheese' },
    { x: 150, y: 480, w: 70, h: 140, t: 'fridge' },
    { x: 1580, y: 480, w: 70, h: 140, t: 'fridge' },
    { x: 800, y: 130, w: 200, h: 50, t: 'crate' },
    { x: 800, y: 920, w: 200, h: 50, t: 'crate' },
  ];

  S.SPAWNS = [
    [120, 120], [1680, 120], [120, 980], [1680, 980],
    [900, 350], [900, 750], [600, 550], [1200, 550],
  ];

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  S.clamp = clamp;

  // Vytlačí kruh (x,y,r) ven ze zdí a překážek.
  S.collide = function (x, y, r) {
    x = clamp(x, r, S.W - r);
    y = clamp(y, r, S.H - r);
    for (const o of S.OBST) {
      const cx = clamp(x, o.x, o.x + o.w);
      const cy = clamp(y, o.y, o.y + o.h);
      const dx = x - cx, dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < r * r) {
        if (d2 > 0.0001) {
          const d = Math.sqrt(d2);
          x = cx + (dx / d) * r;
          y = cy + (dy / d) * r;
        } else {
          const l = x - o.x, rr = o.x + o.w - x, t = y - o.y, b = o.y + o.h - y;
          const m = Math.min(l, rr, t, b);
          if (m === l) x = o.x - r;
          else if (m === rr) x = o.x + o.w + r;
          else if (m === t) y = o.y - r;
          else y = o.y + o.h + r;
        }
      }
    }
    return { x, y };
  };

  S.OH = { crate: 80, cheese: 110, fridge: 170 };   // výšky překážek
  S.CEIL = 230;                                     // strop
  S.EYE = 26;                                       // výška očí krysy
  S.RAT_H = 40;                                     // výška krysy i s čepicí

  // Kam dolétne 3D paprsek (výchozí bod x,y ve výšce h0, sklon slope = tan(pitch)),
  // než narazí do zdi, překážky, podlahy nebo stropu. Vrací vzdálenost v rovině.
  S.rayWall = function (x, y, a, range, h0, slope) {
    if (h0 === undefined) h0 = S.EYE;
    slope = slope || 0;
    const dx = Math.cos(a), dy = Math.sin(a);
    let t = range;
    if (slope > 1e-9) t = Math.min(t, (S.CEIL - h0) / slope);
    else if (slope < -1e-9) t = Math.min(t, h0 / -slope);
    if (dx > 1e-9) t = Math.min(t, (S.W - x) / dx); else if (dx < -1e-9) t = Math.min(t, -x / dx);
    if (dy > 1e-9) t = Math.min(t, (S.H - y) / dy); else if (dy < -1e-9) t = Math.min(t, -y / dy);
    for (const o of S.OBST) {
      let t0 = 0, t1 = t;
      if (Math.abs(dx) < 1e-9) { if (x < o.x || x > o.x + o.w) continue; }
      else { let a1 = (o.x - x) / dx, a2 = (o.x + o.w - x) / dx; if (a1 > a2) { const q = a1; a1 = a2; a2 = q; } t0 = Math.max(t0, a1); t1 = Math.min(t1, a2); }
      if (Math.abs(dy) < 1e-9) { if (y < o.y || y > o.y + o.h) continue; }
      else { let b1 = (o.y - y) / dy, b2 = (o.y + o.h - y) / dy; if (b1 > b2) { const q = b1; b1 = b2; b2 = q; } t0 = Math.max(t0, b1); t1 = Math.min(t1, b2); }
      if (t0 > t1 || t0 >= t) continue;
      const oh = S.OH[o.t] || 80;
      if (h0 + slope * t0 <= oh) { t = t0; }                                   // narazí do boku
      else if (slope < -1e-9) { const tt = (h0 - oh) / -slope; if (tt <= t1 && tt < t) t = Math.max(t0, tt); }  // dopadne na vršek
    }
    return Math.max(0, t);
  };

  // Průsečík paprsku s elipsou krysy (rx podél směru těla, ry napříč). null = mine.
  S.rayEllipse = function (x, y, a, cx, cy, facing, rx, ry) {
    const cf = Math.cos(facing), sf = Math.sin(facing);
    const ox = x - cx, oy = y - cy, dx = Math.cos(a), dy = Math.sin(a);
    const lx = (ox * cf + oy * sf) / rx, ly = (-ox * sf + oy * cf) / ry;
    const ldx = (dx * cf + dy * sf) / rx, ldy = (-dx * sf + dy * cf) / ry;
    const A = ldx * ldx + ldy * ldy, B = lx * ldx + ly * ldy, C = lx * lx + ly * ly - 1;
    const disc = B * B - A * C; if (disc < 0 || A < 1e-12) return null;
    const t = (-B - Math.sqrt(disc)) / A;
    if (t < 0) return C < 0 ? 0 : null;
    return t;
  };

  S.pointBlocked = function (x, y) {
    if (x < 0 || y < 0 || x > S.W || y > S.H) return true;
    for (const o of S.OBST) {
      if (x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h) return true;
    }
    return false;
  };

  // Kde z krysy vylétne sýr (ústí sýrové pušky).
  S.muzzle = function (x, y, a) {
    const c = Math.cos(a), s = Math.sin(a);
    return { x: x + c * 30, y: y + s * 30 };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = S;
  else window.SHARED = S;
})();
