import { School, SchoolSettingsDoc } from "@/lib/firebase/types";

export const SCHOOL_INFO_UNCONFIGURED = "School information not configured";

/**
 * Computes a sensible "YYYY-YYYY" academic year label from the current date instead of a
 * frozen hardcoded string (e.g. "2024-2025") that silently goes stale every year. Used only
 * as an initial default for a newly registered school; the admin can change it any time from
 * Settings. Assumes an academic year that starts in the second half of the calendar year
 * (a common convention); schools can correct this immediately after signup if their cycle
 * differs.
 */
export function getDefaultAcademicYear(referenceDate: Date = new Date()): string {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth(); // 0-indexed
  const startYear = month >= 6 ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
}

function nonempty(value?: string | null): string {
  if (!value) return "";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
}

/**
 * The head's name, ignoring the literal placeholder "Principal" that /api/settings used to write
 * when it auto-created a school's settings (it was never anyone's name). Empty when not set.
 */
export function realPrincipalName(value?: string | null): string {
  const name = nonempty(value);
  return name.toLowerCase() === "principal" ? "" : name;
}

export const DEFAULT_PRINCIPAL_TITLE = "Principal / Head";

export interface SchoolPrintIdentity {
  name: string;
  address: string;
  phone: string;
  email: string;
  principalName: string;
  /** Designation under the head's name; DEFAULT_PRINCIPAL_TITLE when not configured. */
  principalTitle: string;
  /** False when no head of institution is configured in Settings. */
  principalConfigured: boolean;
  campusName: string;
  academicYear: string;
  hasName: boolean;
}

export function schoolPrintIdentity(
  school: School | null | undefined,
  settings: SchoolSettingsDoc | null | undefined
): SchoolPrintIdentity {
  const name = nonempty(settings?.schoolName) || nonempty(school?.name);
  const address = nonempty(settings?.address) || nonempty(school?.address);
  const phone = nonempty(settings?.phone) || nonempty(school?.phone);
  const email = nonempty(settings?.email) || nonempty(school?.email);
  const principalName = realPrincipalName(settings?.principalName) || realPrincipalName(school?.principalName);
  const principalTitle = nonempty(settings?.principalTitle);
  const campusName = nonempty(settings?.campusName);
  const academicYear = nonempty(settings?.academicYear) || nonempty(school?.academicYear);

  return {
    name: name || SCHOOL_INFO_UNCONFIGURED,
    address: address || SCHOOL_INFO_UNCONFIGURED,
    phone: phone || SCHOOL_INFO_UNCONFIGURED,
    email: email || SCHOOL_INFO_UNCONFIGURED,
    principalName: principalName || SCHOOL_INFO_UNCONFIGURED,
    principalTitle: principalTitle || DEFAULT_PRINCIPAL_TITLE,
    principalConfigured: Boolean(principalName),
    campusName,
    academicYear,
    hasName: Boolean(name),
  };
}
