// =====================================================================
// CONTACT ADDRESS: the one email the legal pages and the footer point to,
// set with NEXT_PUBLIC_CONTACT_EMAIL. Unset or malformed means no address,
// so nothing links to a mailto that goes nowhere.
// =====================================================================

// One address: no spaces, no characters that could break out of a mailto link
const EMAIL = /^[^\s@<>"'?&#]+@[^\s@<>"'?&#]+\.[^\s@<>"'?&#]+$/;

// The configured contact address, or null when none (or an invalid one) is set
export function contactEmail(value: string | undefined = process.env.NEXT_PUBLIC_CONTACT_EMAIL): string | null {
  const email = value?.trim();
  return email && EMAIL.test(email) ? email : null;
}

export function mailtoHref(email: string, subject?: string): string {
  return subject ? `mailto:${email}?subject=${encodeURIComponent(subject)}` : `mailto:${email}`;
}
