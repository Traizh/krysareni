#!/usr/bin/env python3
"""Zabalí hru pro itch.io. Použití: python3 make-itch.py wss://tvuj-server.onrender.com"""
import sys, zipfile, os
url = sys.argv[1] if len(sys.argv) > 1 else ""
if url.startswith("https://"): url = "wss://" + url[8:]
os.makedirs("itch", exist_ok=True)
out = "itch/krysi-kolaps-itch.zip"
cfg = '// Adresa multiplayer serveru\nwindow.RAT_CONFIG = { server: "%s" };\n' % url
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    z.write("public/index.html", "index.html")
    z.write("public/shared.js", "shared.js")
    z.write("public/three.module.min.js", "three.module.min.js")
    z.writestr("config.js", cfg)
print("Hotovo:", out, "| server:", url or "(prázdný – zadá se ve hře v 'Server (pokročilé)')")
