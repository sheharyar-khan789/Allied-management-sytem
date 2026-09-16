export * from "./firebase/server-auth";
import { getAuthenticatedUser, AuthenticatedUser } from "./firebase/server-auth";

export async function getSession(): Promise<AuthenticatedUser | null> {
  return getAuthenticatedUser();
}
