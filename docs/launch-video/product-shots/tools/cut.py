# The one place the final cut's timing is defined: where the Nemotron take is spliced into the
# main (v2) voiceover, and how a time in either take maps to a time in the final 2:47 cut.
# Run from docs/launch-video/product-shots, like the other tools.
import subprocess

VO = "../audio/vo-main-v2.mp3"
NEM_VO = "../audio/vo-nemotron.mp3"
INSERT_AT, PAD_IN, PAD_OUT = 107.24, 0.25, 0.35  # splice point in the main take, silence before and after the section


def duration(path):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], capture_output=True, text=True).stdout)


NEM_DUR = duration(NEM_VO)
SHIFT = PAD_IN + NEM_DUR + PAD_OUT  # everything in the main take after INSERT_AT moves this much later


def main_to_final(t):
    """A time in the main take, in the final cut."""
    return t if t <= INSERT_AT else t + SHIFT


def nem_to_final(t):
    """A time in the Nemotron take, in the final cut."""
    return INSERT_AT + PAD_IN + t
