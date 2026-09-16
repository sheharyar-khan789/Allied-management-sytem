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

export interface SchoolPrintIdentity {
  name: string;
  address: string;
  phone: string;
  email: string;
  principalName: string;
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
  const principalName = nonempty(settings?.principalName) || nonempty(school?.principalName);
  const campusName = nonempty(settings?.campusName);
  const academicYear = nonempty(settings?.academicYear) || nonempty(school?.academicYear);

  return {
    name: name || SCHOOL_INFO_UNCONFIGURED,
    address: address || SCHOOL_INFO_UNCONFIGURED,
    phone: phone || SCHOOL_INFO_UNCONFIGURED,
    email: email || SCHOOL_INFO_UNCONFIGURED,
    principalName: principalName || SCHOOL_INFO_UNCONFIGURED,
    campusName,
    academicYear,
    hasName: Boolean(name),
  };
}
