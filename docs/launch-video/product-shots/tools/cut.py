# The one place the final cut's timing is defined. The voiceover is a single full take (v3), so a
# time in the take is the same time in the final cut; the cut only adds TAIL seconds of silence
# at the end for the end card. Run from docs/launch-video/product-shots, like the other tools.
import subprocess

VO = "../audio/vo-full-v3.mp3"
TAIL = 3.0  # silence after the take, so the end card can hold


def duration(path):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], capture_output=True, text=True).stdout)


def to_final(t):
    """A time in the take, in the final cut (the same, with no splice)."""
    return t
