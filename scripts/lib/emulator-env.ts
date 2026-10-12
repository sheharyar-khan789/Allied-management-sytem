/**
 * TEST-ONLY environment for the emulator suites (npm run test:quota). Must be imported before any
 * application module: it refuses to run unless the Firestore emulator is configured with a demo-
 * project id (so a real project can never be touched), then sets a production-like runtime with
 * throwaway secrets. No real credentials or env values are read or printed.
 */
import crypto from "crypto";

export function prepareEmulatorEnv(): void {
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
  const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || "";
  if (!emulatorHost || !projectId.startsWith("demo-")) {
    console.error(
      "Refusing to run: this test needs the Firestore emulator (FIRESTORE_EMULATOR_HOST) and a demo- project id. Use `npm run test:quota`."
    );
    process.exit(1);
  }
  Object.assign(process.env, {
    NODE_ENV: "production",
    FIREBASE_PROJECT_ID: projectId,
    JWT_SECRET: crypto.randomBytes(48).toString("base64"),
    SECURITY_LOG_SILENT: "1",
  });
  for (const key of ["FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY", "GOOGLE_APPLICATION_CREDENTIALS", "NEXT_PUBLIC_FIREBASE_API_KEY", "FIREBASE_API_KEY"]) {
    delete process.env[key];
  }
}
