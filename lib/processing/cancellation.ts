import { AsyncLocalStorage } from "node:async_hooks";
// A recovery continuation can yield before its host's execution deadline.
export const processingCancellation = new AsyncLocalStorage<AbortSignal>();
