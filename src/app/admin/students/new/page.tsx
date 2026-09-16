"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function AddNewStudentPage() {
  const router = useRouter();
  const [classes, setClasses] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // /api/students provisions real Firebase Auth accounts for the student (and, when a guardian
  // email is supplied, for the parent) and returns their one-time passwords exactly once. The
  // page previously redirected straight to the dossier and threw both values away, leaving
  // accounts that nobody could ever sign in to.
  const [credentials, setCredentials] = useState<{
    studentId: string;
    studentName: string;
    studentEmail: string;
    studentPassword?: string;
    guardianEmail?: string;
    guardianPassword?: string;
  } | null>(null);

  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    gender: "Female",
    dob: "",
    bloodGroup: "",
    cnicBForm: "",
    contactNumber: "",
    email: "",
    address: "",
    classId: "",
    rollNumber: "",
    guardianName: "",
    guardianRelation: "Father",
    guardianPhone: "",
    guardianEmail: "",
    guardianOccupation: "",
  });

  useEffect(() => {
    fetch("/api/classes")
      .then((res) => res.json())
      .then((json) => {
        if (json.success && json.classes.length > 0) {
          setClasses(json.classes);
          setFormData((prev) => ({ ...prev, classId: json.classes[0].id }));
        }
      })
      .catch(console.error);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create student.");
      }

      if (data.temporaryPassword || data.parentTemporaryPassword) {
        setCredentials({
          studentId: data.student.id,
          studentName: data.student.fullName,
          studentEmail: data.student.email,
          studentPassword: data.temporaryPassword,
          guardianEmail: data.student.guardianEmail || undefined,
          guardianPassword: data.parentTemporaryPassword,
        });
        window.scrollTo({ top: 0 });
      } else {
        router.push(`/admin/students/${data.student.id}`);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col w-full max-w-4xl mx-auto gap-space-lg">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/students"
            className="p-2 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">arrow_back</span>
          </Link>
          <div>
            <h1 className="font-headline-lg text-2xl font-bold text-on-surface">Add New Student</h1>
            <p className="font-body-md text-xs text-on-surface-variant">
              Register a new student enrollment into Allied School SMS Platform.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-error-container text-on-error-container text-xs flex items-center gap-2 border border-error/20">
          <span className="material-symbols-outlined text-[18px]">error</span>
          <span>{error}</span>
        </div>
      )}

      {credentials && (
        <div
          role="status"
          className="p-4 rounded-xl bg-tertiary-container/10 border border-on-tertiary-container/30 space-y-3"
        >
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-on-tertiary-container text-[20px]">key</span>
            <h2 className="font-headline-md text-sm font-bold text-on-surface">
              {credentials.studentName} enrolled — sign-in details
            </h2>
          </div>
          <p className="text-[11px] leading-relaxed text-on-surface-variant">
            These one-time passwords are shown here once and are not stored anywhere. Copy them
            now and pass them on securely, asking each person to change their password after the
            first sign-in. If lost, they must be reset from the authentication console.
          </p>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            {credentials.studentPassword && (
              <>
                <div className="p-2.5 rounded-lg bg-surface-container-lowest border border-surface-container-high/40">
                  <dt className="text-[10px] uppercase tracking-wider font-bold text-on-surface-variant">
                    Student email
                  </dt>
                  <dd className="font-mono font-semibold text-on-surface break-all mt-0.5">
                    {credentials.studentEmail}
                  </dd>
                </div>
                <div className="p-2.5 rounded-lg bg-surface-container-lowest border border-surface-container-high/40">
                  <dt className="text-[10px] uppercase tracking-wider font-bold text-on-surface-variant">
                    Student temporary password
                  </dt>
                  <dd className="font-mono font-semibold text-on-surface break-all mt-0.5">
                    {credentials.studentPassword}
                  </dd>
                </div>
              </>
            )}
            {credentials.guardianPassword && (
              <>
                <div className="p-2.5 rounded-lg bg-surface-container-lowest border border-surface-container-high/40">
                  <dt className="text-[10px] uppercase tracking-wider font-bold text-on-surface-variant">
                    Guardian email
                  </dt>
                  <dd className="font-mono font-semibold text-on-surface break-all mt-0.5">
                    {credentials.guardianEmail}
                  </dd>
                </div>
                <div className="p-2.5 rounded-lg bg-surface-container-lowest border border-surface-container-high/40">
                  <dt className="text-[10px] uppercase tracking-wider font-bold text-on-surface-variant">
                    Guardian temporary password
                  </dt>
                  <dd className="font-mono font-semibold text-on-surface break-all mt-0.5">
                    {credentials.guardianPassword}
                  </dd>
                </div>
              </>
            )}
          </dl>
          <div className="pt-2 border-t border-surface-container-low">
            <Link
              href={`/admin/students/${credentials.studentId}`}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded bg-secondary text-on-secondary font-semibold text-xs hover:bg-secondary/90"
            >
              <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
              <span>Continue to student profile</span>
            </Link>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        {/* Section 1: Personal Details */}
        <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-surface-container-low">
            <span className="material-symbols-outlined text-secondary text-[20px]">badge</span>
            <h2 className="font-headline-md text-sm font-bold text-on-surface">1. Personal Information</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label htmlFor="new-first-name-1" className="block font-semibold text-on-surface mb-1">
                First Name <span className="text-error">*</span>
              </label>
              <input id="new-first-name-1"
                type="text"
                required
                name="firstName"
                value={formData.firstName}
                onChange={handleChange}
                placeholder="e.g. Zainab"
                className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20"
              />
            </div>

            <div>
              <label htmlFor="new-last-name-2" className="block font-semibold text-on-surface mb-1">
                Last Name <span className="text-error">*</span>
              </label>
              <input id="new-last-name-2"
                type="text"
                required
                name="lastName"
                value={formData.lastName}
                onChange={handleChange}
                placeholder="e.g. Khan"
                className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20"
              />
            </div>

            <div>
              <label htmlFor="new-gender-3" className="block font-semibold text-on-surface mb-1">Gender</label>
              <select id="new-gender-3"
                name="gender"
                value={formData.gender}
                onChange={handleChange}
                className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20"
              >
                <option value="Female">Female</option>
                <option value="Male">Male</option>
              </select>
            </div>

            <div>
              <label htmlFor="new-date-of-birth-4" className="block font-semibold text-on-surface mb-1">Date of Birth</label>
              <input id="new-date-of-birth-4"
                type="date"
                name="dob"
                value={formData.dob}
                onChange={handleChange}
                className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20"
              />
            </div>

            <div>
              <label htmlFor="new-blood-group-5" className="block font-semibold text-on-surface mb-1">Blood Group</label>
              <select id="new-blood-group-5"
                name="bloodGroup"
                value={formData.bloodGroup}
                onChange={handleChange}
                className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20"
              >
                <option value="">Select Blood Group</option>
                <option value="A+">A+</option>
                <option value="A-">A-</option>
                <option value="B+">B+</option>
                <option value="B-">B-</option>
                <option value="O+">O+</option>
                <option value="O-">O-</option>
                <option value="AB+">AB+</option>
                <option value="AB-">AB-</option>
              </select>
            </div>

            <div>
              <label htmlFor="new-cnic-b-form-number-6" className="block font-semibold text-on-surface mb-1">CNIC / B-Form Number</label>
              <input id="new-cnic-b-form-number-6"
                type="text"
                name="cnicBForm"
                value={formData.cnicBForm}
                onChange={handleChange}
                placeholder="e.g. 35201-8765432-2"
                className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20"
              />
            </div>
          </div>
        </div>

        {/* Section 2: Academic Enrollment */}
        <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-surface-container-low">
            <span className="material-symbols-outlined text-secondary text-[20px]">school</span>
            <h2 className="font-headline-md text-sm font-bold text-on-surface">2. Academic Enrollment</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label htmlFor="new-class-section-7" className="block font-semibold text-on-surface mb-1">
                Class & Section <span className="text-error">*</span>
              </label>
              <select id="new-class-section-7"
                required
                name="classId"
                value={formData.classId}
                onChange={handleChange}
                className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20 font-semibold"
              >
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName} ({c.studentCount}/{c.capacity} students)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="new-roll-number-8" className="block font-semibold text-on-surface mb-1">Roll Number</label>
              <input id="new-roll-number-8"
                type="text"
                name="rollNumber"
                value={formData.rollNumber}
                onChange={handleChange}
                placeholder="e.g. 15 (leave blank to auto-assign)"
                className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20"
              />
            </div>
          </div>
        </div>

        {/* Section 3: Guardian Details */}
        <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-surface-container-low">
            <span className="material-symbols-outlined text-secondary text-[20px]">family_restroom</span>
            <h2 className="font-headline-md text-sm font-bold text-on-surface">3. Guardian Details</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label htmlFor="new-guardian-full-name-9" className="block font-semibold text-on-surface mb-1">
                Guardian Full Name <span className="text-error">*</span>
              </label>
              <input id="new-guardian-full-name-9"
                type="text"
                required
                name="guardianName"
                value={formData.guardianName}
                onChange={handleChange}
                placeholder="e.g. Tariq Mahmood Khan"
                className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20"
              />
            </div>

            <div>
              <label htmlFor="new-relationship-10" className="block font-semibold text-on-surface mb-1">Relationship</label>
              <select id="new-relationship-10"
                name="guardianRelation"
                value={formData.guardianRelation}
                onChange={handleChange}
                className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20"
              >
                <option value="Father">Father</option>
                <option value="Mother">Mother</option>
                <option value="Guardian">Guardian</option>
              </select>
            </div>

            <div>
              <label htmlFor="new-guardian-phone-11" className="block font-semibold text-on-surface mb-1">
                Guardian Phone <span className="text-error">*</span>
              </label>
              <input id="new-guardian-phone-11"
                type="tel"
                required
                name="guardianPhone"
                value={formData.guardianPhone}
                onChange={handleChange}
                placeholder="e.g. +92 300 1234567"
                className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20"
              />
            </div>

            <div>
              <label htmlFor="new-guardian-email-12" className="block font-semibold text-on-surface mb-1">Guardian Email</label>
              <input id="new-guardian-email-12"
                type="email"
                name="guardianEmail"
                value={formData.guardianEmail}
                onChange={handleChange}
                placeholder="e.g. guardian@gmail.com"
                className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20"
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="new-residential-address-13" className="block font-semibold text-on-surface mb-1">Residential Address</label>
              <input id="new-residential-address-13"
                type="text"
                name="address"
                value={formData.address}
                onChange={handleChange}
                placeholder="Residential address (Street, Sector, City)"
                className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20"
              />
            </div>
          </div>
        </div>

        {/* Section 4: Initial Admission Fee Challan Breakdown */}
        <div className="p-5 rounded-xl bg-surface-container-low/60 border border-surface-container-high/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <span className="font-label-sm text-[11px] uppercase tracking-wider text-secondary font-bold">
              Automatic Initial Challan
            </span>
            <p className="text-xs text-on-surface font-medium mt-0.5">
              Generates first-month challan: Tuition Rs. 5,000 + Admission Rs. 2,000 + Reg. Rs. 500 ={" "}
              <span className="font-bold text-on-surface">Rs. 7,500</span>
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/admin/students"
              className="px-4 py-2 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-semibold text-xs transition-colors"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 rounded-lg bg-secondary text-on-secondary font-semibold text-xs hover:bg-secondary/90 shadow-sm transition-all disabled:opacity-50 flex items-center gap-1.5"
            >
              {loading ? (
                <span>Registering Student...</span>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[18px]">how_to_reg</span>
                  <span>Complete Enrollment</span>
                </>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
