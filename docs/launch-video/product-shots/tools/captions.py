# Writes the burned-in captions: 2-3-word lower-third captions from both voiceover transcripts,
# in final-cut time (cut.py maps each take). final.py burns the file in with ffmpeg's subtitles filter.
# Usage: python -I tools/captions.py  ->  out/captions.ass
import json, math, os, re, sys

sys.dont_write_bytecode = True  # importing cut.py would otherwise leave tools/__pycache__ behind
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cut import INSERT_AT, main_to_final, nem_to_final

MAIN_JSON = "../vo-v2-transcript.json"
NEM_JSON = "../vo-nemotron-transcript.json"
OUT = "out/captions.ass"

MAX_WORDS = 3
PAUSE = 0.35     # a gap longer than this between words starts a new caption
MIN_ON = 0.4     # shortest time a caption stays up, if the next one has not started
TAIL = 0.2       # extra hold after the last word, if the next one has not started
BREAK_AFTER = re.compile(r"[.,!?;:—–-][\"”')\]]*$")
TAG = re.compile(r"^[\[(].*[\])]$")  # "(chuckles)", "[sighs]"

HEADER = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Segoe UI Semibold,64,&H00FFFFFF,&H00FFFFFF,&H90000000,&HA0000000,0,0,0,0,100,100,0,0,1,3,2,2,120,120,140,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
SOFT = r"{\blur6}"  # blurs the dark outline into a soft shadow; the white fill stays sharp


def spoken(path):
    """The spoken words of a take as (text, start, end), without audio events or bracketed tags."""
    words = json.load(open(path, encoding="utf-8"))["words"]
    return [(w["text"].strip(), w["start"], w["end"]) for w in words
            if w["type"] == "word" and w["text"].strip() and not TAG.match(w["text"].strip())]


def phrases(words):
    """Split at punctuation and pauses."""
    out, cur = [], []
    for w in words:
        if cur and w[1] - cur[-1][2] > PAUSE:
            out.append(cur)
            cur = []
        cur.append(w)
        if BREAK_AFTER.search(w[0]):
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return out


def chunks(phrase):
    """Cut a phrase into evenly sized captions of at most MAX_WORDS (so 4 words make 2+2, not 3+1)."""
    n = math.ceil(len(phrase) / MAX_WORDS)
    size, extra = divmod(len(phrase), n)
    out, i = [], 0
    for k in range(n):
        j = i + size + (k < extra)
        out.append(phrase[i:j])
        i = j
    return out


def captions(words, to_final):
    return [(" ".join(w[0] for w in c), to_final(c[0][1]), to_final(c[-1][2]))
            for p in phrases(words) for c in chunks(p)]


def ts(t):
    cs = round(t * 100)
    return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"


def escape(text):
    return text.replace("\\", "\\\\").replace("{", "(").replace("}", ")")


def main():
    main_words = spoken(MAIN_JSON)
    # Each side of the splice and the Nemotron take are grouped on their own, so no caption crosses it.
    caps = (captions([w for w in main_words if w[1] < INSERT_AT], main_to_final)
            + captions(spoken(NEM_JSON), nem_to_final)
            + captions([w for w in main_words if w[1] >= INSERT_AT], main_to_final))
    caps.sort(key=lambda c: c[1])

    lines = []
    for i, (text, start, end) in enumerate(caps):
        nxt = caps[i + 1][1] if i + 1 < len(caps) else math.inf
        end = max(end, min(max(end + TAIL, start + MIN_ON), nxt))
        lines.append(f"Dialogue: 0,{ts(start)},{ts(end)},Caption,,0,0,0,,{SOFT}{escape(text)}")
        caps[i] = (text, start, end)

    os.makedirs("out", exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(HEADER + "\n".join(lines) + "\n")

    first, last = caps[0], caps[-1]
    print(f"{OUT}: {len(caps)} captions")
    print(f"first {ts(first[1])} - {ts(first[2])}  {first[0]}")
    print(f"last  {ts(last[1])} - {ts(last[2])}  {last[0]}")


if __name__ == "__main__":
    main()
