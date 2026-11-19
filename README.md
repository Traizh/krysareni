# 🐀 Krysí kolaps – sýrová válka

Goofy multiplayer střílečka: krysy s čepicemi, sýrové pušky, šilhavé oči. Bez serveru nehraješ, server = Node + `ws`.

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
WASD / šipky – pohyb · myš – míření · klik – sýr · E – písknutí · M – zvuk
Bonusy: 🩹 léčení, 🧀 rychlopalba, 🌶️ turbo. Kdo první dá 15 zásahů, vyhrává. Místnosti: `?room=kamaradi`.
