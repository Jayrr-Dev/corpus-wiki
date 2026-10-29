# Builds the preview cut: the v3 voiceover take with the rendered product scenes at their times
# and a labelled placeholder card for every shot still to come. The shot list is TIMELINE in
# tools/timeline.py; missing clips fall back to their card. A timecode is burned in.
# Usage: python -I tools/preview.py  ->  out/preview.mp4
import os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from timeline import final_rows, segments, voiceover

FONT = "C\\:/Windows/Fonts/segoeui.ttf"
FONT_B = "C\\:/Windows/Fonts/segoeuib.ttf"


def card(i, label, note):
    open(f"out/seg/{i:02d}a.txt", "w", encoding="utf-8").write(label)
    open(f"out/seg/{i:02d}b.txt", "w", encoding="utf-8").write(note)
    return (f"drawtext=fontfile='{FONT_B}':textfile='out/seg/{i:02d}a.txt':fontcolor=0xdcdcdc:fontsize=58:x=(w-text_w)/2:y=(h/2)-70,"
            f"drawtext=fontfile='{FONT}':textfile='out/seg/{i:02d}b.txt':fontcolor=0x8a8a8a:fontsize=34:x=(w-text_w)/2:y=(h/2)+20,"
            f"drawtext=fontfile='{FONT}':text='PLACEHOLDER':fontcolor=0x5c5c5c:fontsize=24:x=60:y=50")


segs = segments(final_rows(), "out/seg", card)
voiceover("out/vo-full.wav")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", segs, "-i", "out/vo-full.wav",
                "-vf", f"drawtext=fontfile='{FONT}':text='%{{pts\\:hms}}':fontcolor=0xffffff@0.55:fontsize=26:x=w-tw-40:y=h-th-30",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-c:a", "aac", "-b:a", "192k", "-af", "loudnorm=I=-14:TP=-1.5", "-shortest", "out/preview.mp4"], check=True)
print("out/preview.mp4")
