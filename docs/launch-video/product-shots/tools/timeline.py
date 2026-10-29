# The launch video's shot list, and how each shot becomes a video segment. Shared by preview.py
# (labelled placeholder cards, timecode) and final.py (the export). Every timing number comes from cut.py.
# Run from docs/launch-video/product-shots; scripts put tools/ on sys.path before importing this.
import os, subprocess
from cut import VO, NEM_VO, INSERT_AT, PAD_IN, PAD_OUT, SHIFT, nem_to_final

# Main-take (v2) times: (start, end, clip or None, shot label, what goes here).
# Put a clip's path in the third column to swap in a shot; 'path@seconds' starts partway in.
TIMELINE = [
    (0.0, 2.4, "../broll/01-hook-bg.mp4", "Shots 1–2 · Hook", "Chat bubble, then you: “Every company has a Brent.” (avatar)"),
    (2.4, 7.3, "../broll/03-leaving.mp4", "Shot 3 · Someone leaving", "Gemini clip: person walks out with a box"),
    (7.3, 14.1, "../broll/05-whiteboard.mp4", "Shots 4–5 · Desk + whiteboard", "Gemini: you at the desk · messy whiteboard"),
    (14.1, 17.0, None, "Shot 6 · Leaning in", "Gemini: you leaning toward camera"),
    (17.0, 20.9, "../broll/04b-empty-desk.mp4", "Shot 4b · Empty desk", "Gemini: empty desk on a Monday"),
    (20.9, 29.9, "../broll/09-asking.mp4", "Shot 9 · Engineer story", "Gemini: coworkers asking each other"),
    (29.9, 34.4, "out/g07-knowledge-lost.mp4", "Shot 7 · Knowledge lost", "HyperFrames: avatar fades, icons drift away"),
    (34.4, 38.1, "out/g08-stale-docs.mp4", "Shot 8 · Stale docs", "HyperFrames: “Last updated 2 years ago” banner"),
    (38.1, 42.9, "../broll/05-whiteboard.mp4@3", "Shot 9 · Asking around", "Gemini: coworker shrugs and points"),
    (42.9, 45.5, None, "Shot 10 · Evening at home", "Gemini: you on the couch with a laptop"),
    (45.5, 51.0, "out/g11-note-graph.mp4", "Shot 11 · Note-app graph", "Screen recording: Obsidian-style graph"),
    (51.0, 56.5, "../broll/12-typing.mp4", "Shot 12 · Linking by hand", "Your hands typing [[ … ]]"),
    (56.5, 59.1, "out/g13-second-job.mp4", "Shot 13 · A second job", "HyperFrames: tag it → link it → file it → forget it"),
    (59.1, 62.0, "../broll/14-fatigue.mp4", "Shot 14 · Wistful", "Gemini: chin on hand"),
    (62.0, 63.6, "../broll/14b-network.mp4", "Shot 14b · The pause", "Gemini: slow smile to camera"),
    (63.6, 65.0, None, "Shot 15 · “So I built it.”", "Gemini: you hold up the laptop"),
    (65.0, 66.8, "out/16-logo.mp4", "", ""),
    (66.8, 73.4, "out/17-upload.mp4", "", ""),
    (73.4, 79.0, "out/18-page.mp4", "", ""),
    (79.0, 81.5, "out/19-graph.mp4", "", ""),
    (81.5, 82.9, "out/19b-glossary.mp4", "", ""),
    (82.9, 84.6, "out/19c-stakeholders.mp4", "", ""),
    (84.6, 86.6, None, "Shot 20 · “No brackets. Ever.”", "Gemini: playful grin"),
    (86.6, 94.2, "out/21-ask.mp4", "", ""),
    (94.2, 98.2, "out/22a-rewrite.mp4", "", ""),
    (98.2, 101.6, "out/22b-exception.mp4", "", ""),
    (101.6, 107.3, "out/22c-settled.mp4", "", ""),
    (107.3, 111.0, "../broll/23-stays.mp4", "Shot 23 · Knowledge stays", "HyperFrames / Gemini: icons fly into the graph"),
    (111.0, 113.4, None, "Shot 24 · “Still here.”", "Avatar: you, satisfied"),
    (113.4, 118.2, None, "Shots 25–26 · Proof", "Real quotes and real numbers only"),
    (118.2, 123.3, None, "Shot 27 · Floor, talking", "Avatar: “If your team keeps losing knowledge…”"),
    (123.3, 126.5, None, "Shot 28 · “Drop in a folder…”", "Avatar: warm smile, points down"),
    (126.5, 130.0, "out/g29-endcard.mp4", "Shot 29 · End card", "Logo + link"),
]

# The Nemotron / Token Factory section (its own VO take) goes in after "This one keeps up on its own."
# Final-cut times; S is where the section's voice starts.
S = nem_to_final(0)
NEMOTRON = [
    (INSERT_AT, S + 2.4, "../broll/14b-network.mp4@1.2", "", ""),
    (S + 2.4, S + 8.5, "out/n2-title.mp4", "", ""),
    (S + 8.5, S + 26.4, "out/n3-models.mp4", "", ""),
    (S + 26.4, S + 33.3, "out/n6-api.mp4", "", ""),
    (S + 33.3, S + 36.3, "out/n7a-costs.mp4", "", ""),
    (S + 36.3, INSERT_AT + SHIFT, "out/n7b-picker.mp4", "", ""),
]


def final_rows():
    """TIMELINE in final-cut time, with the Nemotron rows spliced in at INSERT_AT."""
    rows = []
    for a, b, *rest in TIMELINE:
        if b <= INSERT_AT + 0.1: rows.append((a, min(b, INSERT_AT), *rest))
        elif a >= INSERT_AT - 0.1: rows.append((max(a, INSERT_AT) + SHIFT, b + SHIFT, *rest))
        else: rows.append((a, b, *rest))
        if abs(b - INSERT_AT) <= 0.1: rows.extend(NEMOTRON)
    return rows


def source(clip):
    """A row's clip ('path' or 'path@seconds') as (path, offset); path is None when the clip is missing."""
    if not clip: return None, 0
    path, _, offset = clip.partition("@")
    return (path if os.path.exists(path) else None), float(offset or 0)


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
    """Writes the full voice track: the main take with the Nemotron take spliced in, padded with silence."""
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", VO, "-i", NEM_VO, "-filter_complex",
                    f"[0]atrim=0:{INSERT_AT},asetpts=PTS-STARTPTS[a];[1]adelay={int(PAD_IN*1000)}:all=1,apad=pad_dur={PAD_OUT}[b];[0]atrim=start={INSERT_AT},asetpts=PTS-STARTPTS[c];[a][b][c]concat=n=3:v=0:a=1[o]",
                    "-map", "[o]", "-ar", "44100", out], check=True)
    return out
