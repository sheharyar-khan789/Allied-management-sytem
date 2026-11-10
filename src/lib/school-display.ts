import { School, SchoolSettingsDoc } from "@/lib/firebase/types";

export const SCHOOL_INFO_UNCONFIGURED = "School information not configured";

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
