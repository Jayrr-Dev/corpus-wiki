type Group = { users: number; timer?: ReturnType<typeof setTimeout>; run: () => void };
const owners = new WeakMap<object, Map<string, Group>>();

// All subscribers sharing a query client and table share one bounded timer.
// Continuous updates still flush every interval; the last unsubscribe cleans up.
export function coalesceInvalidation(owner: object, key: string, run: () => void, intervalMs = 250) {
  let groups = owners.get(owner);
  if (!groups) { groups = new Map(); owners.set(owner, groups); }
  let group = groups.get(key);
  if (!group) { group = { users: 0, run }; groups.set(key, group); }
  group.users++;
  const current = group;
  let disposed = false;
  return {
    trigger() {
      if (disposed || current.timer !== undefined) return;
      current.timer = setTimeout(() => { current.timer = undefined; current.run(); }, intervalMs);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (--current.users === 0) { clearTimeout(current.timer); groups.delete(key); }
    },
  };
}
