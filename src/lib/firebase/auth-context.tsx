"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import {
  User,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  sendPasswordResetEmail as fbResetPassword,
  updatePassword as fbUpdatePassword,
  onAuthStateChanged
} from "firebase/auth";
import { auth, db } from "./config";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { UserProfile, UserRole } from "./types";
import { useRouter } from "next/navigation";

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  role: UserRole | null;
  schoolId: string | null;
  loading: boolean;
  login: (email: string, pass: string) => Promise<UserProfile>;
  signup: (fullName: string, email: string, pass: string, schoolName: string, registrationSecret?: string) => Promise<void>;
  logout: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  changePassword: (newPass: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const router = useRouter();

  // Sync auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        try {
          const userDocRef = doc(db, "users", firebaseUser.uid);
          const snap = await getDoc(userDocRef);
          if (snap.exists()) {
            const prof = snap.data() as UserProfile;
            setProfile(prof);
            // Client state managed in AuthContext; server session managed via allied_session HttpOnly cookie
            document.cookie = "session_user=; path=/; max-age=0";
          } else {
            setProfile(null);
          }
        } catch (e) {
          console.error("Error fetching user profile:", e);
          setProfile(null);
        }
      } else {
        setProfile(null);
        document.cookie = "session_user=; path=/; max-age=0";
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const login = async (email: string, pass: string): Promise<UserProfile> => {
    const userCredential = await signInWithEmailAndPassword(auth, email, pass);
    const uid = userCredential.user.uid;
    const userDocRef = doc(db, "users", uid);
    const snap = await getDoc(userDocRef);
    if (!snap.exists()) {
      throw new Error("User profile not found in Firestore.");
    }
    const prof = snap.data() as UserProfile;
    setProfile(prof);
    document.cookie = "session_user=; path=/; max-age=0";
    return prof;
  };

  const signup = async (
    fullName: string,
    email: string,
    pass: string,
    schoolName: string,
    registrationSecret?: string
  ): Promise<void> => {
    // 1. Create Firebase Auth user on client
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    const idToken = await cred.user.getIdToken();

    // 2. Call server-side atomic registration endpoint (eliminates Firestore rules race conditions)
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName,
        email,
        password: pass,
        schoolName,
        idToken,
        registrationSecret,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "School registration failed.");
    }

    setProfile(data.user);
    document.cookie = "session_user=; path=/; max-age=0";
  };

  const logout = async (): Promise<void> => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {}
    await fbSignOut(auth);
    setUser(null);
    setProfile(null);
    document.cookie = "session_user=; path=/; max-age=0";
    router.push("/login");
  };

  const sendPasswordReset = async (email: string): Promise<void> => {
    await fbResetPassword(auth, email);
  };

  const changePassword = async (newPass: string): Promise<void> => {
    if (!auth.currentUser) throw new Error("No authenticated user.");
    await fbUpdatePassword(auth.currentUser, newPass);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        role: profile?.role || null,
        schoolId: profile?.schoolId || null,
        loading,
        login,
        signup,
        logout,
        sendPasswordReset,
        changePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
