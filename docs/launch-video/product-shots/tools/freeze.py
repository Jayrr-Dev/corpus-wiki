# Turns a raw snapshot (snapshots/<name>.html) into a static page (frozen/<name>.html):
# scripts and the Next.js dev overlay removed, the app's CSS and fonts loaded from assets/.
# Usage: python -I tools/freeze.py upload page ask ...
import re, sys, os

os.makedirs("frozen", exist_ok=True)
for name in sys.argv[1:]:
    raw = open(f"snapshots/{name}.html", encoding="utf-8").read()
    cls = re.search(r'<html class="([^"]*)"', raw).group(1)
    body = re.search(r"(<body.*</body>)", raw, re.S).group(1)
    body = re.sub(r"<script\b.*?</script>", "", body, flags=re.S)
    body = re.sub(r"<nextjs-portal\b.*?</nextjs-portal>", "", body, flags=re.S)
    body = re.sub(r'<link\b[^>]*>', "", body)
    out = f"""<!doctype html>
<html class="{cls}"><head><meta charset="utf-8"><title>{name}</title>
<link rel="stylesheet" href="../assets/app.css">
<style>html,body{{width:1920px;height:1080px;overflow:hidden}} nextjs-portal{{display:none!important}}</style>
</head>
{body}
</html>"""
    open(f"frozen/{name}.html", "w", encoding="utf-8").write(out)
    print("frozen/" + name + ".html", len(out))
