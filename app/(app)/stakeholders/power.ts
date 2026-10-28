// THE ONE POWER IMPORT for this page (the algorithm is docs/power-model.md)
import { computePower, computePowerOverUs } from "@/lib/stakeholders/power";

export { computePower, computePowerOverUs };

// One stakeholder's power, whatever module computes it
export type Power = ReturnType<typeof computePower> extends Map<string, infer P> ? P : never;
