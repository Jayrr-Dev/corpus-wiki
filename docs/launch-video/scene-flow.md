# Launch video: scene flow (v3 take)

Shot by shot for the single full take `audio/vo-full-v3.mp3` (2:50.8). Times are seconds in that take, from `vo-v3-transcript.json`. There is no splice any more: the Nemotron section and the Nebius video line are in the take.

Shot types:
- **YOU**: you on camera. "Lip-sync" means you mouth the line to its count-in clip; "silent" means the voiceover plays over you.
- **PRODUCT**: an animated scene of the app, rebuilt from the app's own components with synthetic Parts Unlimited data. Marketing style: a big cursor, click press and ripple, hover states, toasts, slow push-ins.
- **B-ROLL**: generated clips in `broll/`.
- **GRAPHIC**: scene pages in `product-shots/g*.html` and `n*.html`.

The synthetic world is Parts Unlimited from *The Phoenix Project*: Brent (the lead engineer everyone depends on, who leaves), Bill (VP IT Operations), Wes, Patty, Erik, Sarah, John and Dick; the Phoenix release, the change advisory board, unplanned work, and the move from PayCore to Ledgerly.

## Act 1: Hook (0:00 to 0:06.7)

1. 0.0 to 1.9, **YOU, lip-sync.** "Every company has a Brent." Desk by a window, medium shot, knowing half-smile.
2. 1.9 to 6.7, **B-ROLL** `03-leaving`. "And when Brent leaves… out the door with him." Someone walks out with a box.

## Act 2: The problem (0:06.7 to 0:42.4)

3. 6.7 to 10.0, **B-ROLL** `s03-local-business`. "I've worked at a bunch of small local private companies."
4. 10.0 to 14.4, **B-ROLL** `s04-whiteboard`. "…wasn't sales, or hiring…"
5. 14.4 to 16.8, **B-ROLL** `s05-notebook`. "…it was writing down what people KNOW."
6. 16.8 to 20.6, **B-ROLL** `04b-empty-desk`. "…our most senior engineer left on a Friday."
7. 20.6 to 28.8, **B-ROLL** `09-asking`. "By Monday… piecing it back together…"
8. 28.8 to 33.4, **GRAPHIC** `g07-knowledge-lost`. "Someone leaves, and years of context are just… gone."
9. 33.4 to 37.9, **GRAPHIC** `g08-stale-docs` (Phoenix release runbook, Owner: Brent). "And the docs that DO exist? Stale."
10. 37.9 to 42.4, **B-ROLL** `05-whiteboard@3`. "So people just ask each other. Over… and over."

## Act 3: My own pain (0:42.4 to 1:03.3)

11. 42.4 to 45.4, **B-ROLL** `s11-home-laptop`. "So I tried fixing it for myself first."
12. 45.4 to 51.0, **GRAPHIC** `g11-note-graph`. "Obsidian, Notion… The graphs are GORGEOUS."
13. 51.0 to 56.2, **B-ROLL** `12-typing`. "But making them is SO tedious… by hand."
14. 56.2 to 59.0, **GRAPHIC** `g13-second-job`. "It turns into a second job."
15. 59.0 to 62.2, **B-ROLL** `14-fatigue`. "I always wished it would just… do that for me."
16. 62.2 to 63.3, **B-ROLL** `14b-network`. The pause.

## Act 4: The reveal and demo (1:03.3 to 1:46.7)

17. 63.3 to 65.2, **B-ROLL** `s17-laptop-open`. "So I built it."
18. 65.2 to 66.9, **GRAPHIC** `16-logo`. "It's called Corpus Wiki."
19. 66.9 to 73.6, **PRODUCT: Upload.** "You just feed it… Or connect your Gmail." Files fly onto the drop zone one by one (PDF, Word, notes, a whiteboard photo, a handover video); rows appear and tick to Applied; the cursor clicks Gmail "Import" and two threads land.
20. 73.6 to 79.2, **PRODUCT: Wiki page.** "It pulls out the facts… where it came from." The Phoenix release page writes itself section by section; the cursor clicks one line and the evidence panel slides in with its source.
21. 79.2 to 81.9, **PRODUCT: Graph.** "And it connects everything. The graph," Nodes and links grow in; slow push-in.
22. 81.9 to 82.9, **PRODUCT: Glossary.** "the glossary," Terms pop in (change advisory board, unplanned work, Sev 1).
23. 82.9 to 84.9, **PRODUCT: Stakeholders.** "who's who… AUTOMATICALLY." Brent, Bill, Wes, Patty cards land.
24. 84.9 to 86.8, **B-ROLL** `s24-lean-back`. "No brackets. Ever."
25. 86.8 to 94.4, **PRODUCT: Ask.** The question types in, the cursor clicks Send, the answer streams with numbered source chips that pop.
26. 94.4 to 98.1, **PRODUCT: Rewrite.** "Drop in a newer file…" A toast reports the new file; only one line flashes and rewrites.
27. 98.1 to 101.3, **PRODUCT: Exception.** "…if two files disagree… asks you first." A conflict card; the cursor hovers, then clicks Approve change.
28. 101.3 to 106.7, **PRODUCT: Settled page.** "A normal wiki only knows… keeps up on its own." The approved line, a confirmation toast, a slow drift.

## Hackathon section (1:46.7 to 2:30.0)

29. 106.7 to 109.2, **B-ROLL** `14b-network@1.2`. "So how does it actually work?"
30. 109.2 to 114.8, **GRAPHIC** `n2-title`. "…NVIDIA Nemotron… Nebius Token Factory."
31. 114.8 to 131.8, **PRODUCT: Workflow, AI handoffs.** Nodes light per model in time with the voice: Super at 114.8, Ultra at 121.0, Nano at 126.0, Vision at 127.8.
32. 131.8 to 138.7, **GRAPHIC** `n6-api`. "Token Factory gives us one API… comes back valid."
33. 138.7 to 141.9, **PRODUCT: AI costs.** "Each step gets the cheapest model…" The cursor rests on Nano.
34. 141.9 to 144.7, **PRODUCT: Model picker.** "…switch any of them in settings." Click the role's picker, the list opens, click a model.
35. 144.7 to 150.0, **PRODUCT: Video (new).** "And when it makes a video… serverless job on Nebius cloud." Click Make video; the progress shows "Rendering on Nebius Serverless AI"; the player appears.

## Payoff and call to action (2:30.0 to the end)

36. 150.0 to 153.8, **B-ROLL** `23-stays`. "And when someone leaves… what they knew stays."
37. 153.8 to 156.5, **PRODUCT: Brent's page (new).** "Brent's knowledge? Still here." Brent's stakeholder profile: "Left 3 Apr 2026", 31 facts from 4 sources; the cursor clicks his handover page and it opens, full.
38. 156.5 to 161.3, **PROOF**, real quotes and real numbers only. "I've been testing it with a few teams…" If there are none, cut this line from the audio too.
39. 161.3 to 166.9, **YOU, lip-sync.** "If your team keeps losing knowledge… try it." Same desk as shot 1, talking with your hands.
40. 166.9 to 169.8, **YOU, lip-sync.** "Drop in a folder, and watch it build your brain." Same spot, closer.
41. 169.8 to about 174, **GRAPHIC** `g29-endcard`. "Link's below." Point down as it starts.

## Stock footage for the B-roll

Real stock clips look better than the generated ones (two of those have old-film artifacts). Pexels and Pixabay are free to use in a video without credit; check each clip's licence page anyway. Pick 1080p or 4K, 16:9, clean and modern, no visible brand logos, and no faces that look straight at the camera (so nobody seems to endorse the product).

- Shot 2, someone leaving: "employee leaving office with box", "last day at work box".
- Shot 4, the whiteboard: "office whiteboard sticky notes", "messy whiteboard planning".
- Shot 6, the empty desk: "empty office desk monday", "empty desk computer off".
- Shot 7, people asking around: "coworkers discussing at desk", "colleague asking question office".
- Shot 10, over and over: "office interruption tap on shoulder", "colleagues talking hallway".
- Shot 13, linking by hand: "typing on laptop close up", "hands typing keyboard night".
- Shot 29, the network beat (if you don't film it): "data network abstract", "server room lights".
- Shot 36, what they knew stays: "team collaborating office warm light", "handover meeting laptop".

Put each chosen clip in `broll/` with the shot number in its name (for example `broll/06-stock-empty-desk.mp4`); the timeline points at it from there.

## Totals

- The app on screen (shots 19 to 23, 25 to 28, 31, 33 to 35, 37): about 71 seconds. The hackathon needs at least 60.
- You on camera: only shot 1 and shots 39 to 40, about 10.4 seconds, all lip-sync, at one desk in one sitting.
- Still to build: the 14 product scenes, rebuilt from the app's components, including the new Video and Brent's page scenes.
- New stock-style clips (Veo via OpenRouter, `broll/generate.mjs`): `s03`, `s04`, `s05`, `s11`, `s17`, `s24`.
