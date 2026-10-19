export type DomainPickerGroup = {
  id: string;
  label: string;
  domains: readonly { id: string; path: string }[];
};

// Keep an explicitly chosen tab, but start on a populated tab when nothing is selected.
export function domainPickerGroup(groups: readonly DomainPickerGroup[] | undefined, activeGroup: string) {
  return groups?.find((group) => group.id === activeGroup)
    ?? groups?.find((group) => group.domains.length > 0)
    ?? groups?.[0];
}
