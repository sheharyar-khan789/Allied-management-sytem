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
  signup: (fullName: string, email: string, pass: string, schoolName: string) => Promise<void>;
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
            // Set cookie for Next.js server components / middleware
            document.cookie = `session_user=${encodeURIComponent(
              JSON.stringify({
                uid: prof.uid,
                email: prof.email,
                role: prof.role,
                schoolId: prof.schoolId,
                name: prof.name,
              })
            )}; path=/; max-age=604800; SameSite=Lax`;
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
    document.cookie = `session_user=${encodeURIComponent(
      JSON.stringify({
        uid: prof.uid,
        email: prof.email,
        role: prof.role,
        schoolId: prof.schoolId,
        name: prof.name,
      })
    )}; path=/; max-age=604800; SameSite=Lax`;
    return prof;
  };

  const signup = async (
    fullName: string,
    email: string,
    pass: string,
    schoolName: string
  ): Promise<void> => {
    // 1. Create Firebase Auth user
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    const uid = cred.user.uid;

    // 2. Generate slug-based schoolId
    const schoolSlug = schoolName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const schoolId = `${schoolSlug || "allied-school"}-${Date.now().toString().slice(-4)}`;

    const now = new Date().toISOString();

    // 3. Create School document
    await setDoc(doc(db, "schools", schoolId), {
      id: schoolId,
      name: schoolName,
      code: schoolSlug.toUpperCase().slice(0, 6) || "SCH001",
      academicYear: "2024-2025",
      principalName: fullName,
      email: email,
      createdAt: now,
      updatedAt: now,
    });

    // 4. Create School Settings
    await setDoc(doc(db, "schoolSettings", schoolId), {
      id: schoolId,
      schoolId: schoolId,
      schoolName: schoolName,
      campusName: "Main Campus",
      motto: "Excellence in Education",
      address: "Campus Avenue, City Centre",
      phone: "+92 300 1234567",
      email: email,
      principalName: fullName,
      academicYear: "2024-2025",
      gradingScale: [
        { minPercentage: 90, grade: "A+", gpa: 4.0 },
        { minPercentage: 80, grade: "A", gpa: 3.7 },
        { minPercentage: 70, grade: "B+", gpa: 3.3 },
        { minPercentage: 60, grade: "B", gpa: 3.0 },
        { minPercentage: 50, grade: "C", gpa: 2.5 },
        { minPercentage: 40, grade: "D", gpa: 2.0 },
        { minPercentage: 0, grade: "F", gpa: 0.0 },
      ],
      updatedAt: now,
    });

    // 5. Create Admin User Profile
    const profileData: UserProfile = {
      uid,
      name: fullName,
      email,
      role: "ADMIN",
      schoolId,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    };

    await setDoc(doc(db, "users", uid), profileData);
    setProfile(profileData);

    document.cookie = `session_user=${encodeURIComponent(
      JSON.stringify({
        uid: profileData.uid,
        email: profileData.email,
        role: profileData.role,
        schoolId: profileData.schoolId,
        name: profileData.name,
      })
    )}; path=/; max-age=604800; SameSite=Lax`;
  };

  const logout = async (): Promise<void> => {
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
