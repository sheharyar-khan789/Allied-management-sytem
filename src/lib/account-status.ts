import { adminAuth, hasAdminCredentials } from "@/lib/firebase/admin";
import { getUserByIdServer, updateUserServer } from "@/lib/firebase/server-db";

/**
 * Keeps a login account in step with the record it belongs to. When a student is archived,
 * expelled, made alumni or deleted, their (and only their) login is deactivated: the profile
 * status flips to INACTIVE — which requireAuth checks on every request, so open sessions end
 * immediately — and the Firebase Auth account is disabled so it can't mint new ID tokens.
 * Re-activating the record re-enables the login.
 */
export async function syncLoginActive(
  uid: string | undefined | null,
  schoolId: string,
  active: boolean
): Promise<void> {
  if (!uid) return;
  const profile = await getUserByIdServer(uid);
  // Only ever touch a login of the same school (never trust a stored uid across tenants).
  if (!profile || profile.schoolId !== schoolId) return;
  const status = active ? "ACTIVE" : "INACTIVE";
  if (profile.status !== status) {
    await updateUserServer({ ...profile, status });
  }
  if (hasAdminCredentials) {
    try {
      await adminAuth.updateUser(uid, { disabled: !active });
      if (!active) await adminAuth.revokeRefreshTokens(uid);
    } catch (err: any) {
      if (err?.code !== "auth/user-not-found") {
        console.error("Could not update login account state:", err?.code || "error");
      }
    }
  }
}
