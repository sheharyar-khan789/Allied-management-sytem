import { adminAuth, hasAdminCredentials } from "@/lib/firebase/admin";
import {
  allocateCounterValueServer,
  getUserByEmailServer,
  peekCounterServer,
  raiseCounterToAtLeastServer,
} from "@/lib/firebase/server-db";
import { SchoolSettingsDoc } from "@/lib/firebase/types";

export const DEFAULT_LOGIN_PREFIX = "ASD";
export const DEFAULT_LOGIN_CAMPUS = "campus";
export const DEFAULT_LOGIN_PADDING = 3;
/** Numbers burned on collisions (a manually assigned login that already holds the next number). */
const MAX_COLLISION_SKIPS = 200;

export interface StudentLoginConfig {
  prefix: string;
  campus: string;
  padding: number;
}

/** Login-id parts are lowercase letters/digits only, so the result is always a valid local part. */
export function cleanLoginPart(value: unknown, fallback: string): string {
  const cleaned = String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);
  return cleaned || fallback.toLowerCase();
}

export function resolveLoginConfig(settings: Partial<SchoolSettingsDoc> | null | undefined): StudentLoginConfig {
  const padding = Number(settings?.studentLoginPadding);
  return {
    prefix: cleanLoginPart(settings?.studentLoginPrefix, DEFAULT_LOGIN_PREFIX),
    campus: cleanLoginPart(settings?.studentLoginCampus, DEFAULT_LOGIN_CAMPUS),
    padding: Number.isInteger(padding) && padding >= 1 && padding <= 8 ? padding : DEFAULT_LOGIN_PADDING,
  };
}

export function formatStudentLoginEmail(config: StudentLoginConfig, sequence: number, domain: string): string {
  return `${config.prefix}${config.campus}${String(sequence).padStart(config.padding, "0")}@${domain.toLowerCase()}`;
}

/** The domain student logins live on: the school's own email domain, never a public mail provider. */
export function loginDomainFor(schoolEmail: string | undefined | null): string {
  const at = (schoolEmail || "").lastIndexOf("@");
  const domain = at >= 0 ? schoolEmail!.slice(at + 1).trim().toLowerCase() : "";
  return domain || "alliedschool.edu";
}

export const loginCounterKey = (schoolId: string) => `${schoolId}__studentLogin`;

/** True if the login address is held by a profile or (when available) a Firebase Auth account. */
export async function isLoginEmailTaken(email: string, exceptUid?: string): Promise<boolean> {
  const profile = await getUserByEmailServer(email);
  if (profile && profile.uid !== exceptUid) return true;
  if (hasAdminCredentials) {
    try {
      const record = await adminAuth.getUserByEmail(email);
      if (record.uid !== exceptUid) return true;
    } catch (err: any) {
      if (err?.code !== "auth/user-not-found") throw err;
    }
  }
  return false;
}

/**
 * Allocates the next free student login address. The number comes from an atomic, forward-only
 * counter, so concurrent enrolments get different numbers and a number is never handed out again
 * (not even after the student who held it is deleted). If a manually assigned login already uses
 * the number, that number is skipped and the next one tried.
 */
export async function allocateStudentLoginEmail(
  schoolId: string,
  domain: string,
  config: StudentLoginConfig,
  isTaken: (email: string) => Promise<boolean> = isLoginEmailTaken
): Promise<{ email: string; sequence: number }> {
  for (let attempt = 0; attempt < MAX_COLLISION_SKIPS; attempt++) {
    const sequence = await allocateCounterValueServer(loginCounterKey(schoolId), 1);
    const email = formatStudentLoginEmail(config, sequence, domain);
    if (!(await isTaken(email))) return { email, sequence };
  }
  throw new Error("Could not allocate a unique student login ID.");
}

export const raiseLoginSequence = (schoolId: string, next: number) =>
  raiseCounterToAtLeastServer(loginCounterKey(schoolId), next);

export const peekLoginSequence = (schoolId: string) => peekCounterServer(loginCounterKey(schoolId), 1);
