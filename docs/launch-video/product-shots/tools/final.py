# Exports the finished video: the preview's picture and voiceover with no timecode or placeholder
# cards, out/captions.ass burned in (from tools/captions.py), optional music ducked under the voice,
# and the mix normalised to -14 LUFS integrated, -1.5 dB true peak (two-pass loudnorm).
# Usage: python -I tools/final.py [--allow-missing]  ->  out/final.mp4
# Fails while any shot is missing; --allow-missing puts plain dark frames there for a draft.
import json, os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cut import duration
from timeline import final_rows, segments, source, voiceover

CAPTIONS = "out/captions.ass"
MUSIC = "../audio/music.mp3"
MUSIC_BED = 16  # dB under the voice before ducking; the sidechain takes it to about 19 under overall
LUFS, TP = -14, -1.5


def mmss(t):
    return f"{int(t // 60)}:{t % 60:04.1f}"


def loudness(inputs, graph):
    """loudnorm's first-pass measurement of a filter graph's [o] output."""
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", *inputs, "-filter_complex", f"{graph};[o]loudnorm=I={LUFS}:TP={TP}:LRA=11:print_format=json[m]", "-map", "[m]", "-f", "null", "-"],
                       capture_output=True, text=True, check=True)
    return json.JSONDecoder().raw_decode(r.stderr[r.stderr.rindex("{"):])[0]


sys.stdout.reconfigure(encoding="utf-8")  # shot labels have curly quotes and dots
rows = final_rows()
missing = [(a, label or clip) for a, b, clip, label, note in rows if not source(clip)[0]]
if missing:
    print(f"{len(missing)} shot(s) missing:")
    for a, what in missing: print(f"  {mmss(a)}  {what}")
    if "--allow-missing" not in sys.argv:
        sys.exit("Add the clips, or pass --allow-missing for a draft with dark frames there.")
    print("--allow-missing: dark frames stand in for them.")

segs = segments(rows, "out/seg-final")
voice = voiceover("out/vo-full.wav")
T = duration(voice)

# Audio: the voice, plus the music looped to length, set MUSIC_BED dB under the voice, ducked
# by the voice through sidechaincompress, faded in at the start and out over the last 2 s.
VOICE = "[0]aformat=sample_rates=48000:channel_layouts=stereo"
if os.path.exists(MUSIC):
    inputs = ["-i", voice, "-stream_loop", "-1", "-i", MUSIC]
    voice_i = float(loudness(["-i", voice], f"{VOICE}[o]")["input_i"])
    gain = voice_i - MUSIC_BED - float(loudness(["-i", MUSIC], "[0]anull[o]")["input_i"])
    print(f"Music: {MUSIC} at {gain:+.1f} dB, ducked under the voice.")
    graph = (f"{VOICE},asplit=2[v][key];"
             f"[1]atrim=0:{T},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,volume={gain:.2f}dB,"
             f"afade=t=in:d=1.5,afade=t=out:st={T - 2}:d=2[m];"
             f"[m][key]sidechaincompress=threshold=0.03:ratio=3:attack=30:release=600[duck];"
             f"[v][duck]amix=inputs=2:duration=first:normalize=0[o]")
else:
    print(f"No {MUSIC}: exporting voice only.")
    inputs = ["-i", voice]
    graph = f"{VOICE}[o]"

m = loudness(inputs, graph)
# AAC encoding overshoots the true peak a little (+0.2 dB measured), so aim 0.5 dB under it
norm = (f"loudnorm=I={LUFS}:TP={TP - 0.5}:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}"
        f":measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")
subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", f"{graph};[o]{norm},aresample=48000[a]", "-map", "[a]", "-t", str(T), "out/final-audio.wav"], check=True)

vf = "fps=30"
if os.path.exists(CAPTIONS):
    vf += f",subtitles=filename={CAPTIONS}"
else:
    print(f"Warning: no {CAPTIONS} (run tools/captions.py); exporting without captions.")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", segs, "-i", "out/final-audio.wav", "-map", "0:v", "-map", "1:a",
                "-vf", vf, "-c:v", "libx264", "-profile:v", "high", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30",
                "-c:a", "aac", "-b:a", "192k", "-t", str(T), "-movflags", "+faststart", "out/final.mp4"], check=True)
print("out/final.mp4")
