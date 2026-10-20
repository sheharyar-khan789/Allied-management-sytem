import { School, SchoolSettingsDoc } from "@/lib/firebase/types";
import { currentAcademicYear } from "@/lib/academic-year";

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
  return currentAcademicYear(referenceDate);
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

/**
 * The official head of institution, from the school's Settings only — never an account name.
 *
 * Registration used to copy the registering admin's own name into both School.principalName
 * and the settings' principalName, so report cards printed that account holder (e.g. the admin
 * who signed up) as the principal. School.principalName is therefore never used, and a settings
 * value identical to that registration copy only counts once an admin has saved it in Settings
 * (principalNameConfirmedAt). Empty = not configured.
 */
export function officialPrincipalName(
  settings: Pick<SchoolSettingsDoc, "principalName" | "principalNameConfirmedAt"> | null | undefined,
  school: Pick<School, "principalName"> | null | undefined
): string {
  const name = realPrincipalName(settings?.principalName);
  if (!name || settings?.principalNameConfirmedAt) return name;
  const registrationCopy = nonempty(school?.principalName);
  return registrationCopy && registrationCopy.toLowerCase() === name.toLowerCase() ? "" : name;
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
  const principalName = officialPrincipalName(settings, school);
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
