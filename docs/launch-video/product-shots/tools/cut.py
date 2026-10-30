# The one place the final cut's timing is defined. The voiceover is a single full take (v3); the cut
# removes one stretch of it (CUT, the proof line, which had no real quotes behind it) and adds TAIL
# seconds of silence at the end for the end card. Run from docs/launch-video/product-shots, like the other tools.
import subprocess

VO = "../audio/vo-full-v3.mp3"
TAIL = 3.0  # silence after the take, so the end card can hold
CUT = (156.6, 161.34)  # take seconds removed: "I've been testing it with a few teams… how much it remembers."


def duration(path):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], capture_output=True, text=True).stdout)


def in_cut(t):
    return CUT[0] <= t < CUT[1]


def to_final(t):
    """A time in the take, in the final cut: unchanged before CUT, pulled back by its length after it."""
    a, b = CUT
    return t if t < a else a if t < b else t - (b - a)
