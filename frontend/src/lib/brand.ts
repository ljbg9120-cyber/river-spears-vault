/**
 * The site's name, in one place.
 *
 * The full name is long for a nav bar, so the wordmark stacks: the crew name
 * large, the rest small underneath. Body copy still says "your vault", which
 * reads naturally because the name ends in it.
 */
export const BRAND = {
  full: "River Spears and the Crews Vault",
  /** The line people actually read at a glance. */
  primary: "River Spears",
  /** The smaller line under it. */
  secondary: "and the Crews Vault",
  /** Where the full name is too long — tab titles on mobile, toasts. */
  short: "River Spears Vault",
  tagline: "A home for unreleased music.",
} as const;
