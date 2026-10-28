// THE ONE POWER IMPORT for this page (the algorithm is docs/power-model.md)
import { computePower } from "@/lib/stakeholders/power";

export { computePower };

// One stakeholder's power, whatever module computes it
export type Power = ReturnType<typeof computePower> extends Map<string, infer P> ? P : never;
