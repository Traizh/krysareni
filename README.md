# 🐀 Krysí kolaps FPS – krysí válka

Goofy multiplayer FPS: pohled z očí krysy, 4 zbraně (pistole, samopal, brokovnice, odstřelovačka), šilhavé krysy s čepicemi. Bez serveru nehraješ, server = Node + `ws`.

- `server.js` – autoritativní server (Render), taky servíruje `public/`
- `public/` – hra (`index.html`, `shared.js`, `config.js`)
- `make-itch.py` – zabalí hru pro itch.io

## Lokálně
```
npm install
npm start      # http://localhost:3000
```
Otevři ve dvou oknech, nebo počkej na boty (server doplní arénu na 4 krysy).

## 1) GitHub
```
git init && git add . && git commit -m "Krysí kolaps"
git remote add origin https://github.com/TVOJE-JMENO/krysi-kolaps.git
git push -u origin main
```

## 2) Render
New → **Web Service** → vyber repo. Render si vezme `render.yaml` (Node, free plan, `npm install`, `npm start`).
Dostaneš URL `https://něco.onrender.com`. Free plan po ~15 min bez provozu usne, první připojení pak trvá do minuty
(hra to hlásí). Chceš to udržet vzhůru? Pinguj `/health` třeba přes UptimeRobot.

## 3) itch.io
```
python3 make-itch.py wss://něco.onrender.com
```
Nahraj `itch/krysi-kolaps-itch.zip` jako **HTML**, zaškrtni *This file will be played in the browser*,
viewport třeba 1280×760 + povol fullscreen. (Adresu serveru jde i změnit až ve hře: *Server (pokročilé)*.)

## Ovládání
WASD – pohyb · myš – rozhlížení (klikni do hry, Esc uvolní myš) · levé tlačítko – střelba · pravé tlačítko / F – nůž (zezadu zabíjí hned) · E – písknutí · M – zvuk
Po aréně leží zbraně (samopal, brokovnice, odstřelovačka), 🩹 lékárničky a 🌶️ turbo. Zbraň drží, dokud nedojdou náboje nebo nezemřeš. Kdo první dá 15 zabití, vyhrává. Místnosti: `?room=kamaradi`.
