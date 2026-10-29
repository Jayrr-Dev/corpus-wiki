# Writes the lip-sync clips for the on-camera lines: for each line, the line alone from the v3 take
# (<shot>-<slug>.wav) and a -countin version with three beeps (low, low, high, 0.5 s apart) where the
# first word starts 1.0 s after the high beep. Word times come from the take's transcript.
# Usage: python -I tools/lipsync.py  ->  ../lipsync/*.wav
import glob, json, math, os, struct, subprocess, sys, wave

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cut import VO

TRANSCRIPT = "../vo-v3-transcript.json"
OUT = "../lipsync"
RATE = 44100
PAD = 0.15  # silence kept around the line, cut short where a neighbouring word starts

# (shot, slug, take window from scene-flow.md); a word belongs to the line if its middle is in the window
LINES = [
    (1, "every-company-has-a-brent", 0.0, 1.9),
    (29, "so-how-does-it-work", 106.7, 109.2),
    (37, "brents-knowledge-still-here", 153.8, 156.5),
    (39, "if-your-team", 161.3, 166.9),
    (40, "drop-in-a-folder", 166.9, 169.8),
]

LEAD = 0.5                                  # silence before the first beep
BEEPS = [(0.0, 660), (0.5, 660), (1.0, 1320)]  # (time after LEAD, Hz)
BEEP_LEN, BEEP_VOL = 0.12, 0.5
LINE_AFTER_HIGH = 1.0


def tone(hz):
    n = int(BEEP_LEN * RATE)
    fade = int(0.01 * RATE)
    return [BEEP_VOL * math.sin(2 * math.pi * hz * i / RATE) * min(1, i / fade, (n - i) / fade) for i in range(n)]


def countin(pre):
    """pre seconds of silence with the three beeps in it."""
    s = [0.0] * int(round(pre * RATE))
    for t, hz in BEEPS:
        at = int((LEAD + t) * RATE)
        for i, v in enumerate(tone(hz)): s[at + i] = v
    return struct.pack(f"<{len(s)}h", *(int(v * 32767) for v in s))


def main():
    words = [w for w in json.load(open(TRANSCRIPT, encoding="utf-8"))["words"] if w["type"] == "word"]
    take_end = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", VO], capture_output=True, text=True).stdout)
    for old in glob.glob(f"{OUT}/*.wav"): os.remove(old)
    os.makedirs(OUT, exist_ok=True)
    for shot, slug, a, b in LINES:
        idx = [i for i, w in enumerate(words) if a <= (w["start"] + w["end"]) / 2 < b]
        first, last = words[idx[0]], words[idx[-1]]
        prev_end = words[idx[0] - 1]["end"] if idx[0] > 0 else 0.0
        next_start = words[idx[-1] + 1]["start"] if idx[-1] + 1 < len(words) else take_end
        start, end = max(first["start"] - PAD, prev_end), min(last["end"] + PAD, next_start)
        clean = f"{OUT}/{shot}-{slug}.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{start:.3f}", "-to", f"{end:.3f}", "-i", VO,
                        "-af", f"afade=t=in:d=0.01,afade=t=out:st={end - start - 0.01:.3f}:d=0.01", "-ac", "1", "-ar", str(RATE), "-c:a", "pcm_s16le", clean], check=True)
        with wave.open(clean) as w: line = w.readframes(w.getnframes())
        # the first word, not the clip, lands LINE_AFTER_HIGH after the high beep
        pre = LEAD + BEEPS[-1][0] + LINE_AFTER_HIGH - (first["start"] - start)
        with wave.open(f"{OUT}/{shot}-{slug}-countin.wav", "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
            w.writeframes(countin(pre) + line)
        text = " ".join(words[i]["text"] for i in idx)
        print(f"{shot:>2}  {start:7.2f} to {end:7.2f}  {end - start:4.2f} s  {clean}  {text}")


if __name__ == "__main__":
    main()
