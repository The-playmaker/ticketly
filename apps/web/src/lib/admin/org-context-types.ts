export type OrgContextMode = "global" | "organization" | "none";

export type AdminOrgOption = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
};

export type AdminOrgScope = {
  mode: OrgContextMode;
  /** Set when mode === "organization". */
  organizationId: string | null;
  /** SUPER_ADMIN (or equivalent) may operate without membership. */
  isPlatformAdmin: boolean;
  organizations: AdminOrgOption[];
};
