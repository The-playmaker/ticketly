/** Immutable legal document versions recorded at checkout. Bump when copy changes. */
export const LEGAL_VERSIONS = {
  terms: "2026-10-terms-v1",
  privacy: "2026-10-privacy-v1",
  refundPolicy: "2026-10-refund-v1",
} as const;

export type LegalVersions = typeof LEGAL_VERSIONS;
