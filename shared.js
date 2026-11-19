// Sdílená fyzika a mapa – používá server i klient (predikce pohybu).
(function () {
  const S = {};
  S.W = 1800;
  S.H = 1100;
  S.PR = 18;          // poloměr krysy
  S.SPEED = 230;      // px/s
  S.BULLET_SPEED = 650;
  S.MAX_HP = 100;

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
    return { x: x + c * 38 - s * 9, y: y + s * 38 + c * 9 };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = S;
  else window.SHARED = S;
})();
