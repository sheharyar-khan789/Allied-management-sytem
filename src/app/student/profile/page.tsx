"use client";

import React, { useEffect, useState } from "react";
import { formatDate } from "@/lib/utils";

export default function StudentProfilePage() {
  const [student, setStudent] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/student/me")
      .then((res) => res.json())
      .then((d) => {
        if (d?.success) setStudent(d.student);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <div className="w-10 h-10 border-4 border-secondary border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs text-on-surface-variant">Loading profile...</p>
      </div>
    );
  }

  if (!student) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center p-8 bg-surface-container-lowest rounded-xl border border-surface-container-high/40 max-w-lg mx-auto">
        <span className="material-symbols-outlined text-4xl text-on-surface-variant mb-2">person_off</span>
        <h2 className="text-lg font-bold text-on-surface">No Profile Linked</h2>
        <p className="text-xs text-on-surface-variant mt-1">
          Your account is not currently linked to an active student record. Please contact the school administration.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full max-w-4xl mx-auto gap-space-lg">
      {/* Profile Card */}
      <div className="p-6 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-col sm:flex-row sm:items-center gap-6">
        <div className="w-20 h-20 rounded-xl bg-secondary text-white flex items-center justify-center font-headline-lg text-3xl font-bold shadow-md shrink-0">
          {student?.firstName?.charAt(0)}
          {student?.lastName?.charAt(0)}
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="font-headline-lg text-2xl font-bold text-on-surface">
              {student?.firstName} {student?.lastName}
            </h1>
            <span className="px-2.5 py-0.5 rounded-full bg-secondary/10 text-secondary font-label-sm text-xs font-bold font-mono">
              {student?.admissionNumber}
            </span>
          </div>
          <p className="font-body-md text-xs text-on-surface-variant">
            {student?.class?.name}-{student?.class?.section} • Roll #{student?.rollNumber} • Status: Active Student
          </p>
        </div>
      </div>

      {/* Grid: Biodata & Guardian */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Personal Details */}
        <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-4">
          <h3 className="font-headline-md text-sm font-bold text-on-surface border-b border-surface-container-low pb-2 flex items-center gap-2">
            <span className="material-symbols-outlined text-secondary text-[18px]">person</span>
            Student Biodata
          </h3>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-on-surface-variant">Full Name</span>
              <p className="font-semibold text-on-surface">{student?.firstName} {student?.lastName}</p>
            </div>
            <div>
              <span className="text-on-surface-variant">Gender</span>
              <p className="font-semibold text-on-surface">{student?.gender}</p>
            </div>
            <div>
              <span className="text-on-surface-variant">Date of Birth</span>
              <p className="font-semibold text-on-surface">{formatDate(student?.dob)}</p>
            </div>
            <div>
              <span className="text-on-surface-variant">Blood Group</span>
              <p className="font-semibold text-on-surface">{student?.bloodGroup || "Not Specified"}</p>
            </div>
            <div>
              <span className="text-on-surface-variant">B-Form / CNIC</span>
              <p className="font-semibold text-on-surface font-mono">{student?.cnicBForm || "Not Provided"}</p>
            </div>
            <div>
              <span className="text-on-surface-variant">Admission Date</span>
              <p className="font-semibold text-on-surface">{formatDate(student?.admissionDate)}</p>
            </div>
          </div>
        </div>

        {/* Guardian Details */}
        <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-4">
          <h3 className="font-headline-md text-sm font-bold text-on-surface border-b border-surface-container-low pb-2 flex items-center gap-2">
            <span className="material-symbols-outlined text-secondary text-[18px]">family_restroom</span>
            Parent & Guardian Information
          </h3>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-on-surface-variant">Guardian Name</span>
              <p className="font-semibold text-on-surface">{student?.guardianName || "Not Specified"}</p>
            </div>
            <div>
              <span className="text-on-surface-variant">Relationship</span>
              <p className="font-semibold text-on-surface">{student?.guardianRelation || "Not Specified"}</p>
            </div>
            <div>
              <span className="text-on-surface-variant">Contact Phone</span>
              <p className="font-semibold text-on-surface font-mono">{student?.guardianPhone || "Not Provided"}</p>
            </div>
            <div>
              <span className="text-on-surface-variant">Guardian Email</span>
              <p className="font-semibold text-on-surface truncate">{student?.guardianEmail || "Not Provided"}</p>
            </div>
            <div className="col-span-2">
              <span className="text-on-surface-variant">Residential Address</span>
              <p className="font-semibold text-on-surface">{student?.address || "Not Provided"}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
