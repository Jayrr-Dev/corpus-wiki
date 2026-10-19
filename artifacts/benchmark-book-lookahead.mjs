import { forEachLookahead } from '../lib/processing/lookahead.ts';
const items = Array.from({length: 12}, (_, i) => i);
for (const limit of [1, 2]) {
  const started = performance.now();
  let inFlight = 0, peak = 0;
  await forEachLookahead(items, {limit, context: () => 'same validated context',
    read: async (item) => { inFlight++; peak = Math.max(peak, inFlight); await new Promise(resolve => setTimeout(resolve, 25)); inFlight--; return {value:item}; },
    consume: async () => {},
  });
  console.log(JSON.stringify({limit, durationMs:Math.round(performance.now()-started), peakRequests:peak}));
}
