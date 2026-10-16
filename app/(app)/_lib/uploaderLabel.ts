export function uploaderLabel(event: { person_id: string | null; via: string | null; actor?: string } | null | undefined, personName: string | null | undefined): string | null {
  // The actor records who processed the upload; person_id records who submitted it.
  if (event?.person_id) return personName ?? null;
  if (event?.via === "api") return "API key";
  return event?.actor === "ai" ? "AI" : null;
}
