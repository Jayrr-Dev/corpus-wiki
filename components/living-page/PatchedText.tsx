"use client";

import { memo, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { diffWords } from "@/components/diff/diffWords";
import { linkArticleText, type ArticleLink } from "@/lib/living-page/articleEvidence";
import { ArticleTextLink } from "./previewTabs";
import styles from "./PatchedText.module.css";

const subscribeMotion = (notify: () => void) => {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const serverMotion = () => true;
const EMPTY_LINKS: ArticleLink[] = [];

const LinkedText = memo(function LinkedText({ text, links }: { text: string; links: ArticleLink[] }) {
  return useMemo(() => linkArticleText(text, links).map((chunk, index) => chunk.href
    ? <ArticleTextLink key={index} href={chunk.href} label={chunk.text} className="text-link hover:underline">{chunk.text}</ArticleTextLink>
    : <span key={index}>{chunk.text}</span>), [text, links]);
});

// Animate committed changes only. Stable text and citations never fade with them.
// A new update supersedes the active transition; timers cannot restore old text.
export function PatchedText({ text, links = EMPTY_LINKS }: { text: string; links?: ArticleLink[] }) {
  const reduce = useSyncExternalStore(subscribeMotion, reducedMotion, serverMotion);
  const [transition, setTransition] = useState({ source: text, before: text, phase: "idle" });
  if (transition.source !== text) {
    setTransition({ source: text, before: transition.phase === "out" ? transition.before : transition.source, phase: reduce ? "idle" : "out" });
  }
  useEffect(() => {
    if (transition.phase === "idle") return;
    const timer = window.setTimeout(() => setTransition((current) => current === transition
      ? { ...current, phase: current.phase === "out" && !reduce ? "in" : "idle" } : current), reduce ? 0 : transition.phase === "out" ? 160 : 480);
    return () => window.clearTimeout(timer);
  }, [transition, reduce]);
  const parts = useMemo(() => patchDisplayParts(transition.before, text), [transition.before, text]);
  const linked = (value: string) => <LinkedText text={value} links={links} />;
  if (reduce || transition.phase === "idle") return linked(text);
  return <>
    {parts.map((part, index) => part.kind === "same" ? <span key={index}>{linked(part.text)}</span>
      : part.kind === "removed" ? (transition.phase === "out" ? <span key={index} aria-hidden="true" className={styles.fade}>{part.text}</span> : null)
        : <span key={index} className={transition.phase === "out" ? "sr-only" : styles.reveal}>{linked(part.text)}</span>)}
  </>;
}

// Bound the quadratic word diff for unusually large pasted paragraphs.
export function patchDisplayParts(before: string, after: string) {
  if (before === after) return [{ kind: "same" as const, text: after }];
  if (before.length * after.length < 1_000_000) return diffWords(before, after);
  let start = 0, end = 0;
  while (start < Math.min(before.length, after.length) && before[start] === after[start]) start++;
  while (end < Math.min(before.length, after.length) - start && before[before.length - end - 1] === after[after.length - end - 1]) end++;
  return [
    { kind: "same" as const, text: after.slice(0, start) },
    { kind: "removed" as const, text: before.slice(start, before.length - end) },
    { kind: "added" as const, text: after.slice(start, after.length - end) },
    { kind: "same" as const, text: after.slice(after.length - end) },
  ].filter((part) => part.text);
}
