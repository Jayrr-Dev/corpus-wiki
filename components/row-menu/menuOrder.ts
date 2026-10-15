// =====================================================================
// MENU RULES for every "…" menu (RowMenu, DialogMenu):
//   1. Like things sit together; a divider (`separatorBefore`) starts a new
//      group, e.g. Open | Revise, Link, Set status | Retire.
//   2. Destructive items (retire, remove, delete, undo…) always come last,
//      in their own group below a divider. Callers need not order them:
//      this moves them down and draws the divider.
// =====================================================================

type Orderable = { isDestructive?: boolean; separatorBefore?: boolean };

// The items in display order, each with whether a divider goes above it
export function orderMenuItems<T extends Orderable>(items: readonly T[]): { item: T; hasSeparator: boolean }[] {
  const safe = items.filter((item) => !item.isDestructive);
  const destructive = items.filter((item) => item.isDestructive);
  return [...safe, ...destructive].map((item, index) => ({
    item,
    hasSeparator: index > 0 && (Boolean(item.separatorBefore) || (index === safe.length && destructive.length > 0)),
  }));
}
