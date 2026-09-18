"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import FileUpload from "@/components/FileUpload";

// Every field starts empty. These are real personnel records: the form previously opened
// pre-filled with an invented designation ("Senior Science & Math Educator"), qualification
// ("M.Sc Mathematics / B.Ed") and specialization, all of which were saved verbatim as though
// they were the teacher's genuine credentials whenever the admin only filled in the required
// name/email/phone fields. `gender` was collected but never sent anywhere by the API, so it
// has been dropped rather than left as a control that silently does nothing.
const EMPTY_TEACHER_FORM = {
  firstName: "",
  lastName: "",
  designation: "",
  qualification: "",
  specialization: "",
  phone: "",
  email: "",
  photoUrl: "",
  baseSalary: "",
};

export default function TeachersManagementPage() {
  const [teachers, setTeachers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [error, setError] = useState("");
  // The API provisions a real Firebase Auth account and returns its one-time password exactly
  // once, never storing or logging it. Until now the UI discarded that value silently, so a
  // newly created teacher had a working account nobody could ever sign in to. It is now shown
  // to the admin so they can hand it over.
  const [newCredentials, setNewCredentials] = useState<
    { email: string; password: string; name: string } | null
  >(null);

  const [formData, setFormData] = useState(EMPTY_TEACHER_FORM);

  const fetchTeachers = async () => {
    try {
      const res = await fetch(`/api/teachers?search=${encodeURIComponent(search)}`);
      const json = await res.json();
      if (json.success) {
        setTeachers(json.teachers);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTeachers();
  }, [search]);

  const handleAddTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setFormLoading(true);

    try {
      const res = await fetch("/api/teachers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to add teacher.");
      }

      setModalOpen(false);
      if (data.temporaryPassword) {
        setNewCredentials({
          name: data.teacher?.fullName || `${formData.firstName} ${formData.lastName}`.trim(),
          email: data.teacher?.email || formData.email,
          password: data.temporaryPassword,
        });
      }
      setFormData(EMPTY_TEACHER_FORM);
      fetchTeachers();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setFormLoading(false);
    }
  };

  return (
    <div className="flex flex-col w-full gap-space-lg">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-headline-lg text-2xl font-bold text-on-surface">
              Faculty & Teaching Staff
            </h1>
            <span className="px-2.5 py-0.5 rounded-full bg-secondary/10 text-secondary font-label-sm text-xs font-bold">
              {teachers.length} Faculty
            </span>
          </div>
          <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
            Manage academic instructors, departmental designations, subject allocations, and workload.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-on-secondary font-label-md text-xs font-semibold hover:bg-secondary/90 shadow-sm transition-all self-start sm:self-auto"
        >
          <span className="material-symbols-outlined text-[18px]">person_add</span>
          <span>Add New Teacher</span>
        </button>
      </div>

      {newCredentials && (
        <div
          role="status"
          className="p-4 rounded-xl bg-tertiary-container/10 border border-on-tertiary-container/30 space-y-3"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-on-tertiary-container text-[20px]">
                key
              </span>
              <h2 className="font-headline-md text-sm font-bold text-on-surface">
                Sign-in details for {newCredentials.name}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setNewCredentials(null)}
              className="text-on-surface-variant hover:text-on-surface shrink-0"
              aria-label="Dismiss sign-in details"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-on-surface-variant">
            This one-time password is shown here once and is not stored anywhere. Copy it now and
            pass it to the teacher securely — ask them to change it after their first sign-in. If
            you lose it, the password must be reset from the authentication console.
          </p>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-2.5 rounded-lg bg-surface-container-lowest border border-surface-container-high/40">
              <dt className="text-[10px] uppercase tracking-wider font-bold text-on-surface-variant">
                Email
              </dt>
              <dd className="font-mono font-semibold text-on-surface break-all mt-0.5">
                {newCredentials.email}
              </dd>
            </div>
            <div className="p-2.5 rounded-lg bg-surface-container-lowest border border-surface-container-high/40">
              <dt className="text-[10px] uppercase tracking-wider font-bold text-on-surface-variant">
                Temporary password
              </dt>
              <dd className="font-mono font-semibold text-on-surface break-all mt-0.5">
                {newCredentials.password}
              </dd>
            </div>
          </dl>
        </div>
      )}

      {/* Filter & Search Bar */}
      <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px]">
            search
          </span>
          <input
            type="search"
            aria-label="Search faculty"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search faculty by name, ID, specialization, designation..."
            className="w-full h-9 pl-9 pr-4 rounded-lg bg-surface-container-low font-body-md text-xs text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:bg-surface-container-lowest focus:ring-2 focus:ring-secondary/20 transition-all border border-transparent focus:border-outline-variant/50"
          />
        </div>
      </div>

      {/* Teachers Directory Table */}
      <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
        {loading ? (
          <div className="p-12 flex flex-col items-center justify-center space-y-3">
            <div className="w-8 h-8 border-3 border-secondary border-t-transparent rounded-full animate-spin"></div>
            <p className="text-xs text-on-surface-variant">Loading faculty roster...</p>
          </div>
        ) : teachers.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <span className="material-symbols-outlined text-4xl text-outline-variant">school</span>
            <p className="text-sm font-semibold text-on-surface">No faculty records found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-surface-container-low text-on-surface-variant font-label-sm text-[11px] uppercase tracking-wider border-b border-surface-container-high/40">
                  <th className="py-3 px-4 font-bold">Faculty Member</th>
                  <th className="py-3 px-4 font-bold">Employee ID</th>
                  <th className="py-3 px-4 font-bold">Designation & Qualification</th>
                  <th className="py-3 px-4 font-bold">Specialization</th>
                  <th className="py-3 px-4 font-bold">Contact & Email</th>
                  <th className="py-3 px-4 font-bold">Workload</th>
                  <th className="py-3 px-4 font-bold">Base Salary</th>
                  <th className="py-3 px-4 font-bold">Status</th>
                  <th className="py-3 px-4 font-bold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container-low">
                {teachers.map((t) => (
                  <tr key={t.id} className="hover:bg-surface-container-low/40 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5">
                        {t.photoUrl ? (
                          <img
                            src={t.photoUrl}
                            alt={t.fullName}
                            className="w-8 h-8 rounded-full object-cover border border-surface-container-high shrink-0"
                            onError={(e) => {
                              (e.currentTarget as HTMLElement).style.display = "none";
                            }}
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs shrink-0">
                            {t.firstName.charAt(0)}
                            {t.lastName.charAt(0)}
                          </div>
                        )}
                        <div className="flex flex-col min-w-0">
                          <Link
                            href={`/admin/teachers/${t.id}`}
                            className="font-bold text-on-surface hover:text-secondary truncate"
                          >
                            {t.fullName}
                          </Link>
                          <span className="text-[10px] text-on-surface-variant">{t.designation}</span>
                        </div>
                      </div>
                    </td>

                    <td className="py-3 px-4 font-mono font-semibold text-on-surface">{t.employeeId}</td>

                    <td className="py-3 px-4">
                      <div className="font-semibold text-on-surface">{t.designation}</div>
                      <div className="text-[10px] text-on-surface-variant">{t.qualification}</div>
                    </td>

                    <td className="py-3 px-4 font-medium text-on-surface">{t.specialization}</td>

                    <td className="py-3 px-4">
                      <div className="font-medium text-on-surface">{t.phone}</div>
                      <div className="text-[10px] text-on-surface-variant truncate">{t.email}</div>
                    </td>

                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded bg-surface-container font-semibold text-secondary">
                        {t.taughtSubjectsCount} Courses
                      </span>
                    </td>

                    <td className="py-3 px-4 font-semibold text-on-surface">
                      {t.baseSalary ? `Rs. ${Number(t.baseSalary).toLocaleString()}` : "—"}
                    </td>

                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded-full bg-tertiary-container/10 text-on-tertiary-container font-bold text-[10px]">
                        {t.status}
                      </span>
                    </td>

                    <td className="py-3 px-4 text-right">
                      <Link
                        href={`/admin/teachers/${t.id}`}
                        className="p-1.5 rounded-lg hover:bg-surface-container text-secondary transition-colors inline-block"
                        title="View Faculty Profile"
                        aria-label="View faculty profile"
                      >
                        <span className="material-symbols-outlined text-[18px]">visibility</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Teacher Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-faculty-heading"
            className="bg-surface-container-lowest rounded-xl max-w-lg w-full p-5 shadow-2xl border border-surface-container-high space-y-4 max-h-[90vh] overflow-y-auto my-8"
          >
            <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
              <h3 id="add-faculty-heading" className="font-headline-md text-sm font-bold text-on-surface">Add New Faculty Member</h3>
              <button
                onClick={() => setModalOpen(false)}
                className="text-on-surface-variant hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {error && (
              <div className="p-2.5 rounded bg-error-container text-on-error-container text-xs flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px]">error</span>
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleAddTeacher} className="space-y-3 text-xs">
              <div className="pb-2 border-b border-surface-container-low">
                <FileUpload
                  folder="profile-photos"
                  label="Faculty Photograph"
                  helperText="Upload official portrait (JPG, PNG, WebP up to 5MB)"
                  currentUrl={formData.photoUrl}
                  onUploadComplete={(url) => setFormData({ ...formData, photoUrl: url })}
                  onRemove={() => setFormData({ ...formData, photoUrl: "" })}
                  previewType="image"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="teachers-first-name-1" className="block font-semibold text-on-surface mb-1">First Name *</label>
                  <input id="teachers-first-name-1"
                    type="text"
                    required
                    value={formData.firstName}
                    onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                    placeholder="e.g. Sana"
                    className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                  />
                </div>
                <div>
                  <label htmlFor="teachers-last-name-2" className="block font-semibold text-on-surface mb-1">Last Name *</label>
                  <input id="teachers-last-name-2"
                    type="text"
                    required
                    value={formData.lastName}
                    onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                    placeholder="e.g. Javaid"
                    className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                  />
                </div>
                <div>
                  <label htmlFor="teachers-email-3" className="block font-semibold text-on-surface mb-1">Email *</label>
                  <input id="teachers-email-3"
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="sana.javaid@alliedschool.edu"
                    className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                  />
                </div>
                <div>
                  <label htmlFor="teachers-phone-4" className="block font-semibold text-on-surface mb-1">Phone *</label>
                  <input id="teachers-phone-4"
                    type="tel"
                    required
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="+92 300 0000000"
                    className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                  />
                </div>
                <div>
                  <label htmlFor="teachers-designation-5" className="block font-semibold text-on-surface mb-1">Designation</label>
                  <input id="teachers-designation-5"
                    type="text"
                    value={formData.designation}
                    onChange={(e) => setFormData({ ...formData, designation: e.target.value })}
                    placeholder="Senior Science Educator"
                    className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                  />
                </div>
                <div>
                  <label htmlFor="teachers-qualification-6" className="block font-semibold text-on-surface mb-1">Qualification</label>
                  <input id="teachers-qualification-6"
                    type="text"
                    value={formData.qualification}
                    onChange={(e) => setFormData({ ...formData, qualification: e.target.value })}
                    placeholder="M.Sc / B.Ed"
                    className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                  />
                </div>
                <div className="col-span-2">
                  <label htmlFor="teachers-specialization-7" className="block font-semibold text-on-surface mb-1">Specialization</label>
                  <input id="teachers-specialization-7"
                    type="text"
                    value={formData.specialization}
                    onChange={(e) => setFormData({ ...formData, specialization: e.target.value })}
                    placeholder="e.g. Mathematics, Physical Sciences"
                    className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                  />
                </div>
                <div className="col-span-2">
                  <label htmlFor="teachers-base-salary" className="block font-semibold text-on-surface mb-1">Base Monthly Salary (PKR)</label>
                  <input id="teachers-base-salary"
                    type="number"
                    min="0"
                    step="500"
                    value={formData.baseSalary}
                    onChange={(e) => setFormData({ ...formData, baseSalary: e.target.value })}
                    placeholder="e.g. 50000"
                    className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-surface-container-low">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-3 py-1.5 rounded bg-surface-container text-on-surface font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="px-4 py-1.5 rounded bg-secondary text-on-secondary font-semibold hover:bg-secondary/90 disabled:opacity-50"
                >
                  {formLoading ? "Creating..." : "Save Faculty"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
