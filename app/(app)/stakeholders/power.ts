// THE ONE POWER IMPORT for this page. Once the power lane lands, change this line to
// `import { computePower } from "@/lib/stakeholders/power";` and delete powerStandIn.ts.
import { computePower } from "./powerStandIn";

export { computePower };

// One stakeholder's power, whatever module computes it
export type Power = ReturnType<typeof computePower> extends Map<string, infer P> ? P : never;
