# Builds a scene page: a frozen app snapshot plus the engine, the scrub and the scene script.
# Usage: python -I tools/build.py <scene> <snapshot> [shared scripts...]   e.g. 17-upload upload  ->  17-upload.html
import sys, re

scene, snap = sys.argv[1], sys.argv[2]
html = open(f"frozen/{snap}.html", encoding="utf-8").read().replace('href="../assets/', 'href="assets/')
extra = "".join(f'<script src="scenes/{x}.js"></script>' for x in sys.argv[3:])
scripts = f'<script src="engine.js"></script><script src="scenes/common.js"></script>{extra}<script src="scenes/{scene}.js"></script>'
html = html.replace("</head>", scripts + "\n</head>", 1)
open(f"{scene}.html", "w", encoding="utf-8").write(html)
print(f"{scene}.html")
