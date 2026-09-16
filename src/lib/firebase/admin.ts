import { initializeApp, getApps, getApp, cert } from "firebase-admin/app";
import type { App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { Auth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";

let adminApp: App;

if (getApps().length === 0) {
  const resolvedProjectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  // Same fail-fast rationale as the client Firebase config (src/lib/firebase/config.ts): a
  // hardcoded "allied-school-system" fallback here would let a production deployment that
  // forgot FIREBASE_PROJECT_ID silently initialize the Admin SDK against a project that isn't
  // its own — including cases where real FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY credentials
  // are present but paired with the wrong project id. Local development keeps the placeholder
  // so a fresh clone still runs before Firebase is configured.
  if (process.env.NODE_ENV === "production" && !resolvedProjectId) {
    throw new Error(
      "Critical: Firebase Admin SDK is not configured for production. Set FIREBASE_PROJECT_ID " +
        "(see .env.example) instead of letting the app fall back to a placeholder project."
    );
  }
  const projectId = resolvedProjectId || "allied-school-system";
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    : undefined;

  if (clientEmail && privateKey) {
    adminApp = initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
      projectId,
    });
  } else {
    adminApp = initializeApp({
      projectId,
    });
  }
} else {
  adminApp = getApp();
}

export const hasAdminCredentials =
  (!!process.env.FIREBASE_CLIENT_EMAIL && !!process.env.FIREBASE_PRIVATE_KEY) ||
  !!process.env.FIRESTORE_EMULATOR_HOST ||
  !!process.env.GOOGLE_APPLICATION_CREDENTIALS;

export const adminAuth: Auth = getAuth(adminApp);
export const adminDb: Firestore = getFirestore(adminApp);
export { adminApp };
