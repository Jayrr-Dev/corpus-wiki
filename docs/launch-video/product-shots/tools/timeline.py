# The launch video's shot list, and how each shot becomes a video segment. Shared by preview.py
# (labelled placeholder cards, timecode) and final.py (the export). Every timing number comes from cut.py.
# Run from docs/launch-video/product-shots; scripts put tools/ on sys.path before importing this.
import os, subprocess
from cut import VO, TAIL, duration, to_final

END = duration(VO) + TAIL  # the end card holds through the silence after the take

# Take (v3) times from scene-flow.md: (start, end, clip or None, shot label, what goes here).
# 'path@seconds' starts partway in; 'a|b' uses the first clip that exists. A missing clip shows
# a placeholder card with the label and note, so keep both filled in.
TIMELINE = [
    # Act 1: Hook
    (0.0, 1.9, "../camera/01-every-company.mp4", "Shot 1 · You, lip-sync", "“Every company has a Brent.” Desk by a window, knowing half-smile"),
    (1.9, 6.7, "../broll/03-leaving.mp4", "Shot 2 · Someone leaving", "B-roll: person walks out with a box"),
    # Act 2: The problem
    (6.7, 10.0, "../camera/03-companies.mp4", "Shot 3 · You, silent", "Wide, casual, laptop and coffee"),
    (10.0, 14.4, "../broll/05-whiteboard.mp4", "Shot 4 · Whiteboard", "B-roll: messy office whiteboard"),
    (14.4, 16.8, "../camera/05-what-people-know.mp4", "Shot 5 · You, silent", "Lean toward the camera, sincere"),
    (16.8, 20.6, "../broll/04b-empty-desk.mp4", "Shot 6 · Empty desk", "B-roll: empty desk on a Monday"),
    (20.6, 28.8, "../broll/09-asking.mp4", "Shot 7 · Piecing it together", "B-roll: coworkers asking each other"),
    (28.8, 33.4, "out/g07-knowledge-lost.mp4", "Shot 8 · Knowledge lost", "Graphic: years of context, gone"),
    (33.4, 37.9, "out/g08-stale-docs.mp4", "Shot 9 · Stale docs", "Graphic: Phoenix release runbook, Owner: Brent"),
    (37.9, 42.4, "../broll/05-whiteboard.mp4@3", "Shot 10 · Over and over", "B-roll: people asking each other"),
    # Act 3: My own pain
    (42.4, 45.4, "../camera/11-fixing-it.mp4", "Shot 11 · You, silent", "At the laptop, the screen lighting your face"),
    (45.4, 51.0, "out/g11-note-graph.mp4", "Shot 12 · Note-app graph", "Graphic: Obsidian-style graph"),
    (51.0, 56.2, "../broll/12-typing.mp4", "Shot 13 · Linking by hand", "B-roll: hands typing [[ … ]]"),
    (56.2, 59.0, "out/g13-second-job.mp4", "Shot 14 · A second job", "Graphic: tag it, link it, file it, forget it"),
    (59.0, 62.2, "../camera/15-wished.mp4", "Shot 15 · You, silent", "Chin on hand, looking away"),
    (62.2, 63.3, "../camera/16-the-pause.mp4", "Shot 16 · You, silent", "The pause: look into the lens, a slow smile starts"),
    # Act 4: The reveal and demo
    (63.3, 65.2, "../camera/17-so-i-built-it.mp4", "Shot 17 · You, silent", "“So I built it.” Hold the open laptop up to the camera"),
    (65.2, 66.9, "out/16-logo.mp4", "Shot 18 · Logo", "Graphic: “It's called Corpus Wiki.”"),
    (66.9, 73.6, "out/p-upload.mp4", "Shot 19 · Upload", "Product: files fly onto the drop zone; Gmail import"),
    (73.6, 79.2, "out/p-page.mp4", "Shot 20 · Wiki page", "Product: the Phoenix release page writes itself; evidence panel"),
    (79.2, 81.9, "out/p-graph.mp4", "Shot 21 · Graph", "Product: nodes and links grow in; slow push-in"),
    (81.9, 82.9, "out/p-glossary.mp4", "Shot 22 · Glossary", "Product: terms pop in"),
    (82.9, 84.9, "out/p-stakeholders.mp4", "Shot 23 · Stakeholders", "Product: Brent, Bill, Wes, Patty cards land"),
    (84.9, 86.8, "../camera/24-no-brackets.mp4", "Shot 24 · You, silent", "“No brackets. Ever.” Grin, small head shake"),
    (86.8, 94.4, "out/p-ask.mp4", "Shot 25 · Ask", "Product: question, Send, answer streams with source chips"),
    (94.4, 98.1, "out/p-rewrite.mp4", "Shot 26 · Rewrite", "Product: a newer file; one line flashes and rewrites"),
    (98.1, 101.3, "out/p-exception.mp4", "Shot 27 · Exception", "Product: conflict card; click Approve change"),
    (101.3, 106.7, "out/p-settled.mp4", "Shot 28 · Settled page", "Product: the approved line, a toast, a slow drift"),
    # Hackathon section
    (106.7, 109.2, "../camera/29-how-does-it-work.mp4|../broll/14b-network.mp4", "Shot 29 · How does it work?", "You, lip-sync (optional), or B-roll 14b-network"),
    (109.2, 114.8, "out/n2-title.mp4", "Shot 30 · Nemotron title", "Graphic: NVIDIA Nemotron on Nebius Token Factory"),
    (114.8, 131.8, "out/p-models.mp4", "Shot 31 · AI handoffs", "Product: nodes light per model (Super, Ultra, Nano, Vision)"),
    (131.8, 138.7, "out/n6-api.mp4", "Shot 32 · One API", "Graphic: Token Factory API, valid output"),
    (138.7, 141.9, "out/p-costs.mp4", "Shot 33 · AI costs", "Product: cheapest model per step; cursor on Nano"),
    (141.9, 144.7, "out/p-picker.mp4", "Shot 34 · Model picker", "Product: open a role's picker, click a model"),
    (144.7, 150.0, "out/p-video.mp4", "Shot 35 · Video", "Product: Make video, Rendering on Nebius Serverless AI"),
    # Payoff and call to action
    (150.0, 153.8, "../broll/23-stays.mp4", "Shot 36 · Knowledge stays", "B-roll: what they knew stays"),
    (153.8, 156.5, "../camera/37-still-here.mp4", "Shot 37 · You, lip-sync", "“Brent's knowledge? Still here.” Leaning back, satisfied"),
    (156.5, 161.3, None, "Shot 38 · Proof", "Real quotes and real numbers only, or cut the line"),
    (161.3, 166.9, "../camera/39-if-your-team.mp4", "Shot 39 · You, lip-sync", "“If your team keeps losing knowledge…” Talking with your hands"),
    (166.9, 169.8, "../camera/40-drop-in-a-folder.mp4", "Shot 40 · You, lip-sync", "“Drop in a folder…” Same spot, closer"),
    (169.8, END, "out/g29-endcard.mp4", "Shot 41 · End card", "Logo + link. “Link's below.”"),
]


def final_rows():
    """TIMELINE in final-cut time (the take's own time; there is no splice)."""
    return [(to_final(a), to_final(b), *rest) for a, b, *rest in TIMELINE]


def source(clip):
    """A row's clip ('path', 'path@seconds' or 'a|b') as (path, offset); path is None when no clip exists."""
    for c in (clip or "").split("|"):
        path, _, offset = c.partition("@")
        if path and os.path.exists(path): return path, float(offset or 0)
    return None, 0


# Generated B-roll: crop the film-gate border Veo adds, and soften the whiteboard's gibberish handwriting
def broll_fix(clip):
    if "broll" not in clip: return ""
    f = "crop=iw*0.88:ih*0.88:iw*0.08:ih*0.06," if "hook-bg" in clip else "crop=iw*0.96:ih*0.96,"
    if "whiteboard" in clip: f += "gblur=sigma=7,"
    return f


def segments(rows, folder, card=lambda i, label, note: ""):
    """Renders each row to <folder>/NN.mp4 (1920x1080, 30 fps, silent) and writes <folder>/list.txt for
    ffmpeg's concat demuxer. A missing clip becomes a dark frame with card(i, label, note)'s filter on it."""
    os.makedirs(folder, exist_ok=True)
    parts = []
    for i, (a, b, clip, label, note) in enumerate(rows):
        dur = round(b - a, 3)
        seg = f"{folder}/{i:02d}.mp4"
        path, offset = source(clip)
        if path:
            cmd = ["ffmpeg", "-v", "error", "-y", "-ss", str(offset), "-i", path, "-t", str(dur), "-vf", f"fps=30,{broll_fix(path)}scale=1920:1080,tpad=stop_mode=clone:stop_duration={dur}", "-t", str(dur), "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", seg]
        else:
            vf = card(i, label, note)
            cmd = ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c=0x161616:s=1920x1080:r=30:d={dur}", *(["-vf", vf] if vf else []), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", seg]
        subprocess.run(cmd, check=True)
        parts.append(seg)
    with open(f"{folder}/list.txt", "w") as f:
        f.writelines(f"file '{os.path.basename(p)}'\n" for p in parts)
    return f"{folder}/list.txt"


def voiceover(out):
    """Writes the full voice track: the take, then TAIL seconds of silence for the end card."""
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", VO, "-af", f"apad=pad_dur={TAIL}", "-ar", "44100", out], check=True)
    return out
