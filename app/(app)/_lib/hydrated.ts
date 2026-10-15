import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

// HYDRATED: false on the server and while hydrating, true after. A Suspense boundary can hydrate after
// queries elsewhere on the page have filled the cache, so data read during hydration must wait for this.
export function useHydrated(): boolean {
  return useSyncExternalStore(noSubscribe, () => true, () => false);
}
