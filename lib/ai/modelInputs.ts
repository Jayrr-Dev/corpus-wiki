// =====================================================================
// WHAT DATA A MODEL CAN READ: client-safe, so /settings and /skills can
// tag each model and offer a role only the models that read its data.
// Taken from the provider's listing (Token Factory's modality, Claude's
// capabilities); a model that says nothing is taken to read text only.
// =====================================================================

export const DATA_TYPES = ["text", "image"] as const;
export type DataType = (typeof DATA_TYPES)[number];

export const DATA_TYPE_LABELS: Record<DataType, string> = { text: "Text", image: "Images" };

// A model on offer and the data it reads
export type OfferedModel = { id: string; inputs: DataType[] };

// "text+image->text" → ["text", "image"]; no modality → text only
export function inputsFromModality(modality: string | undefined): DataType[] {
  const read = (modality?.split("->")[0] ?? "text").split("+");
  return DATA_TYPES.filter((type) => type === "text" || read.includes(type));
}

// True when a model that reads `inputs` can take every type in `needs` (unknown models read text only)
export const readsAll = (inputs: readonly DataType[] | undefined, needs: readonly DataType[]) => needs.every((type) => (inputs ?? ["text"]).includes(type));

// The types `needs` asks for that `inputs` cannot read
export const missingTypes = (inputs: readonly DataType[] | undefined, needs: readonly DataType[]) => needs.filter((type) => !(inputs ?? ["text"]).includes(type));

// ["text", "image"] → "Text, images"
export function describeTypes(types: readonly DataType[]): string {
  const text = types.map((type) => DATA_TYPE_LABELS[type].toLowerCase()).join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
