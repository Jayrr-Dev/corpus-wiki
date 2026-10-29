import { Screentone } from "@/components/standard/screentone";

// =====================================================================
// TOPIC CARD PARTS shared by the Study and Docs lists: the textured cover
// with a topic's initials, and the outline marks for topics under it.
// =====================================================================

// Each topic card gets its own texture, picked from its name, so cards tell apart at a glance
const COVER_TONES = ["clouds", "folds", "marble", "streaks"] as const;
const COVER_KINDS = ["dots", "lines", "diamonds", "rings"] as const;
const hash = (text: string) => [...text].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
const initials = (name: string) => name.split(/\s+/).filter((word) => /^\p{L}/u.test(word)).slice(0, 2).map((word) => word[0]!.toLocaleUpperCase()).join("") || name.slice(0, 1);

// COVER: a textured tile with the topic's initials, where a picture can go later
export function TopicCover({ name }: { name: string }) {
  const seed = hash(name);
  return (
    <div aria-hidden className="relative isolate flex w-20 shrink-0 items-center justify-center overflow-hidden border-r bg-link/8 sm:w-24">
      <Screentone kind={COVER_KINDS[seed % COVER_KINDS.length]} tone={COVER_TONES[(seed >> 3) % COVER_TONES.length]} density={[0.55, 0.08]} size={7} seed={seed % 97} color="var(--color-link)" opacity={0.35} />
      <span className="text-2xl font-semibold tracking-tight text-link">{initials(name)}</span>
    </div>
  );
}

// OUTLINE MARK: 1, 2… then a, b… then i, ii… by nesting level
const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];
export function outlineMark(index: number, level: number): string {
  if (level % 3 === 0) return String(index + 1);
  if (level % 3 === 1) return index < 26 ? String.fromCharCode(97 + index) : String(index + 1);
  return ROMAN[index] ?? String(index + 1);
}
