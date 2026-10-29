# Launch video: handoff

This is everything needed to finish the Corpus Wiki demo video from another machine. The full shot-by-shot plan is in [script-storyboard.md](script-storyboard.md).

## Where it stands (2026-10-29)

- **Preview cut:** [product-shots/out/preview.mp4](product-shots/out/preview.mp4), **2:47.0**, 1920×1080, with grey "PLACEHOLDER" cards wherever a shot is still missing. A timecode is burned into the bottom-right corner.
- **Voiceover:** done, in your ElevenLabs "Samuel" voice clone on Eleven v4.
  - [audio/vo-main-v2.mp3](audio/vo-main-v2.mp3): the main take, 2:07.6.
  - [audio/vo-nemotron.mp3](audio/vo-nemotron.mp3): the NVIDIA section, 38.8 s.
  - [audio/vo-full-spliced.mp3](audio/vo-full-spliced.mp3): both together as the final 2:47 track.
  - Word-level timings: `vo-v2-transcript.json` and `vo-nemotron-transcript.json`.
- **Product shots:** done. 15 animated scenes, built on the real app UI with synthetic data (Brightline Co., Dave, billing sync). The clips are in [product-shots/out/](product-shots/out/), and how they're made is in [product-shots/README.md](product-shots/README.md).
- **B-roll:** done. 10 Veo 3.1 Lite clips in [broll/](broll/), cost $2.60.
  - `01-hook-bg` (sprocket hole and scratch) and `05-whiteboard` (gibberish handwriting) have old-timey artifacts. Replace them with real office footage, or regenerate them clean.
- **Hackathon rules** (Nebius Global AI Hackathon):
  - Public YouTube video, 3:00 or less.
  - Shows Nebius Token Factory and NVIDIA Nemotron (1:47–2:27).
  - At least 1 minute of the app in action; about 62 s now.
  - Tick YouTube's "altered or synthetic content" box when uploading.

## Still to do

1. **Film the on-camera shots at the office.** This is the main job: lip-sync to the voiceover, as described below.
2. **HyperFrames graphics** (still placeholders):
   - knowledge lost (0:29.9)
   - stale docs banner (0:34.4)
   - "tag it / link it / file it / forget it" (0:56.5)
   - end card with logo and link (2:45.9)
3. **Shot 11 (0:45.5):** a screen recording of an Obsidian-style graph.
4. **Shots 25–26 (2:32.8):** real user quotes and real numbers only. Cut them if there are none, which also cuts "I've been testing it with a few teams…".
5. **Final edit:** swap each placeholder for its clip (see "Rebuilding the preview"), add music and sound effects, add 2–3-word captions in the lower third (use the transcript JSONs), mix to about −14 LUFS and export.

### Plan (2026-10-29)

Lanes run in parallel on their own branches and are merged into `launch-video` one task at a time. Each lane edits only its own rows. Final-cut timing comes from `product-shots/tools/cut.py` and nowhere else.

| Lane | Task | Needs | Status |
|---|---|---|---|
| graphics | Shots 7, 8, 13 as scene pages (`g07-knowledge-lost`, `g08-stale-docs`, `g13-second-job`), rendered to `out/` | | in progress |
| graphics | Shot 11 stand-in graph (`g11-note-graph`) and shot 29 end card overlay (`g29-endcard`) | graphics: 7, 8, 13 | waiting |
| captions | `tools/captions.py` writes `out/captions.ass` from both transcripts, in final-cut time | cut.py | in progress |
| final | `tools/timeline.py` holds TIMELINE and the splice; `preview.py` imports it | cut.py | in progress |
| final | `tools/final.py`: no placeholder labels or timecode, captions burned in, optional music ducked under the VO, −14 LUFS, writes `out/final.mp4` | final: timeline, captions | waiting |
| integration | Wire the `g*` clips into `timeline.py` | graphics, final: timeline | waiting |
| you | Copy `product-shots/out/*.mp4` from the other machine | | waiting on you |
| you | Office shoot; shots 25–26 quotes or cut; end card URL; music track | | waiting on you |

## Lip-sync shoot (office)

You mime to the voiceover so your lips match the cloned voice exactly.

**How to film a line:**
1. Play its `-countin` clip from [lipsync/](lipsync/) out loud, from a phone or laptop speaker near the camera. You'll hear three beeps (low, low, high), and the line starts one second after the high beep.
2. Mouth along with the line, at full energy, as if you were saying it.
3. Do 3 takes per line.
4. Keep the camera's own audio. Line up the beeps in the edit, then swap in the clean clip without the count-in (or the spliced track).

**Camera:**
- 16:9, 1080p or higher, 25 or 30 fps.
- Clean modern look: no filters, no grain, no vintage effects.
- Window light on your face, you off-centre (rule of thirds).
- Wear the dark navy button-up with sleeves rolled, and the silver watch.

### Lines you speak on camera

| # | Final time | Line | Clip | Framing |
|---|---|---|---|---|
| 1 | 0:00.0–0:02.4 | "Every company has a Dave." | `1-every-company-has-a-dave` (1.9 s) | Desk, medium shot, knowing half-smile |
| 2 | 1:47.2–1:49.9 | "So how does it actually work?" | `2-so-how-does-it-work` (2.4 s) | Optional (B-roll covers it now). Desk, leaning in |
| 3 | 2:30.4–2:32.8 | "Dave's knowledge? *(chuckle)* Still here." | `3-daves-knowledge-still-here` (2.3 s) | Leaning back, satisfied |
| 4 | 2:37.6–2:42.7 | "If your team keeps losing knowledge or you're tired of linking notes by hand, try it." | `4-if-your-team` (5.1 s) | A relaxed spot (sofa or break area), talking with your hands |
| 5 | 2:42.7–2:46.0 | "Drop in a folder and watch it build your brain. Link's below." | `5-drop-in-a-folder-links-below` (4.2 s) | Same spot, closer; point down on "Link's below" |

### Silent cutaways (no lip-sync; the voiceover plays over them)

| Final time | Action |
|---|---|
| 0:14.1–0:17.0 | Lean toward the camera, sincere |
| 0:42.9–0:45.5 | At the laptop, scrolling, the screen lighting your face |
| 0:59.1–1:02.0 | Chin on hand, looking away, wistful |
| 1:02.0–1:03.6 | Look into the lens; a slow smile starts (the beat before the reveal) |
| 1:03.6–1:05.0 | Hold the open laptop up to the camera, screen facing out |
| 1:24.6–1:26.6 | Grin, small head shake ("No brackets. Ever.") |

Optional real office B-roll that can replace generated clips: a real whiteboard, an empty desk, two colleagues talking (only with their OK, or blurred).

Every line as a separate clip is in [vo-lines/](vo-lines/), with times in `vo-lines/index.txt`. Those times are in the main take (v2). Anything after 1:47.24 shifts by +39.37 s in the final cut.

## Rebuilding the preview

```bash
cd docs/launch-video/product-shots
python -I tools/preview.py
```

This writes `out/preview.mp4`. To swap a placeholder for a real clip, put the clip's path in the third column of its row in `TIMELINE` in `tools/preview.py`. Times there are main-take (v2) times, and the Nemotron section is spliced in automatically at 1:47.24. Use `"path@2.5"` to start 2.5 s into a clip.

## What is not in git, and why

- `product-shots/snapshots/`, `frozen/` and the built scene pages (`17-upload.html` and so on): these hold real workspace data and the signed-in email. The repo is **public**, so they stay local. To change a product shot, re-snapshot your own app on that machine (see the product-shots README), or edit the rendered clips.
- `avatar/` images and your reference photo: no face stills go in the repo.
- Paid APIs used: OpenRouter (B-roll and stills, $2.71 of the $10 budget, enforced in `broll/generate.mjs`) and ElevenLabs (voice and transcripts). Keys stay in `.env.local`, never in git.
