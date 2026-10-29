# Print text-dump lines (from tools/texts.js via eval.mjs) whose x is greater than a threshold
import json, sys
sys.stdout.reconfigure(encoding="utf-8")
s = json.load(open(sys.argv[1], encoding="utf-8"))
for l in s.split("\n"):
    if int(l.split(",")[0]) > int(sys.argv[2]): print(l)
