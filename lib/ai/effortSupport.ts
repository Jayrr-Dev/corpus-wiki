// =====================================================================
// WHICH MODELS USE A REASONING EFFORT: client-safe, so /settings can turn
// the effort control off for a model that would ignore it.
// =====================================================================

// Nemotron 3 runs with thinking off, so a reasoning effort changes nothing for it
export const isNemotron3 = (model: string) => /^nvidia\/(?:nvidia-)?nemotron-3[\/_.-]/i.test(model);

// True when the model's calls honour the reasoning effort
export const usesEffort = (model: string) => !isNemotron3(model);
