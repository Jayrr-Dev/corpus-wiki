# Product shots

Animated product shots for the launch video. Each one is built on a snapshot of the real app, so it looks exactly like Corpus Wiki. The data is synthetic (Brightline Co., Dave, billing sync).

Each scene starts from a frozen snapshot of the app. `scenes/common.js` swaps the workspace name, your name and your email, and the scene script fills in synthetic content and animates it. Every scene is drawn frame by frame, so renders are exact.

| Scene | VO line | Snapshot |
|---|---|---|
| `16-logo` | "It's called Corpus Wiki." | standalone |
| `17-upload` | "You just feed it PDFs… or connect your Gmail." | upload |
| `18-page` | "It pulls out the facts… where it came from." | page-line |
| `19-graph` | "And it connects everything: the graph," | graph |
| `19b-glossary` | "the glossary," | glossary |
| `19c-stakeholders` | "who's who, automatically." | stakeholders |
| `21-ask` | "Ask it anything… with sources." | ask |
| `22a-rewrite` | "Drop in a newer file…" | page-line |
| `22b-exception` | "And if two files disagree, it asks you first." | exception-open |
| `22c-settled` | "A normal wiki only knows… keeps up on its own." | page-line |
| `n2-title` | "…NVIDIA Nemotron… Nebius Token Factory." | standalone |
| `n3-models` | Super / Ultra / Nano / Vision roles | workflow-ai |
| `n6-api` | "One API… structured output…" | standalone |
| `n7a-costs` | "Each step gets the cheapest model…" | settings-costs |
| `n7b-picker` | "…switch any of them in settings." | settings-intelligence |

## Commands

```bash
python -I tools/build.py 18-page page-line article   # scene + snapshot (+ shared scripts) -> 18-page.html
node render.mjs 18-page.html 30                      # -> out/18-page.mp4 (1920x1080)
node render.mjs 18-page.html --still=2.5             # one frame -> out/18-page-2.5.png
python -I tools/preview.py                           # voiceover + scenes + placeholders -> out/preview.mp4
```

Open a built scene page in a browser to watch it loop.

Requirements: Node 22+, Chrome or Edge, ffmpeg.

## New snapshots

1. Run `node tools/receive.mjs`. It listens on 127.0.0.1:4599.
2. In the signed-in app, POST `document.body.outerHTML` to the receiver as `<name>.html`.
3. Run `python -I tools/freeze.py <name>`.

`snapshots/`, `frozen/` and the built scene pages hold real data, so they are git-ignored. Keep it that way.

## Swapping placeholders for real clips

In `tools/preview.py`, put a clip's path in the third column of its timeline row, then run the script again.
