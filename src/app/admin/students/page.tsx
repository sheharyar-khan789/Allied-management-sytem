"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function StudentsManagementPage() {
  const router = useRouter();
  const [students, setStudents] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedClass, setSelectedClass] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");

  const fetchStudents = async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.append("search", search);
      if (selectedClass !== "all") params.append("classId", selectedClass);
      if (selectedStatus !== "all") params.append("status", selectedStatus);

      const res = await fetch(`/api/students?${params.toString()}`);
      const json = await res.json();
      if (json.success) {
        setStudents(json.students);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchClasses = async () => {
    try {
      const res = await fetch("/api/classes");
      const json = await res.json();
      if (json.success) {
        setClasses(json.classes);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchClasses();
  }, []);

  useEffect(() => {
    fetchStudents();
  }, [search, selectedClass, selectedStatus]);

  const [editingStudent, setEditingStudent] = useState<any>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState("");
  const [editFormData, setEditFormData] = useState({
    firstName: "",
    lastName: "",
    gender: "Female",
    dob: "",
    bloodGroup: "",
    rollNumber: "",
    classId: "",
    status: "ACTIVE",
    contactNumber: "",
    guardianName: "",
    guardianRelation: "Father",
    guardianPhone: "",
    guardianEmail: "",
  });

  const openEditModal = (st: any) => {
    setEditingStudent(st);
    setEditFormData({
      firstName: st.firstName || "",
      lastName: st.lastName || "",
      gender: st.gender || "Female",
      dob: st.dob || "",
      bloodGroup: st.bloodGroup !== "Not Specified" ? st.bloodGroup : "",
      rollNumber: st.rollNumber || "",
      classId: st.classId || "",
      status: st.status || "ACTIVE",
      contactNumber: st.contactNumber || "",
      guardianName: st.guardianName || "",
      guardianRelation: st.guardianRelation || "Father",
      guardianPhone: st.guardianPhone || "",
      guardianEmail: st.guardianEmail || "",
    });
    setEditError("");
    setEditModalOpen(true);
  };

  const handleSaveStudentEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditError("");
    setEditLoading(true);
    try {
      const res = await fetch(`/api/students/${editingStudent.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editFormData),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update student.");
      }
      setEditModalOpen(false);
      fetchStudents();
    } catch (err: any) {
      setEditError(err.message || "Failed to update student.");
    } finally {
      setEditLoading(false);
    }
  };

  const handleArchive = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to archive student ${name}?`)) return;
    try {
      const res = await fetch(`/api/students/${id}`, { method: "DELETE" });
      if (res.ok) {
        fetchStudents();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteStudent = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete student ${name}?`)) return;
    // Optimistically update UI immediately
    setStudents((prev) => prev.filter((s) => s.id !== id));
    try {
      const res = await fetch(`/api/students/${id}?permanent=true`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to delete student.");
        fetchStudents();
      }
    } catch (err) {
      console.error("Error deleting student:", err);
      alert("Failed to delete student.");
      fetchStudents();
    }
  };

  return (
    <div className="flex flex-col w-full gap-space-lg">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-headline-lg text-2xl font-bold text-on-surface">
              Students Directory
            </h1>
            <span className="px-2.5 py-0.5 rounded-full bg-secondary/10 text-secondary font-label-sm text-xs font-bold">
              {students.length} Enrolled
            </span>
          </div>
          <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
            Manage student records, class enrollments, dossiers, and academic standing.
          </p>
        </div>

        <Link
          href="/admin/students/new"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-on-secondary font-label-md text-xs font-semibold hover:bg-secondary/90 shadow-sm transition-all self-start sm:self-auto"
        >
          <span className="material-symbols-outlined text-[18px]">person_add</span>
          <span>Add New Student</span>
        </Link>
      </div>

      {/* Filter & Search Bar */}
      <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px]">
            search
          </span>
          <input
            type="search"
            aria-label="Search students"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, admission #, roll #, guardian..."
            className="w-full h-9 pl-9 pr-4 rounded-lg bg-surface-container-low font-body-md text-xs text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:bg-surface-container-lowest focus:ring-2 focus:ring-secondary/20 transition-all border border-transparent focus:border-outline-variant/50"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Class Filter */}
          <select
            value={selectedClass}
            onChange={(e) => setSelectedClass(e.target.value)}
            className="h-9 px-3 rounded-lg bg-surface-container-low text-xs font-medium text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20"
          >
            <option value="all">All Classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
              </option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="h-9 px-3 rounded-lg bg-surface-container-low text-xs font-medium text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20"
          >
            <option value="all">All Statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </div>
      </div>

      {/* Students Table */}
      <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
        {loading ? (
          <div className="p-12 flex flex-col items-center justify-center space-y-3">
            <div className="w-8 h-8 border-3 border-secondary border-t-transparent rounded-full animate-spin"></div>
            <p className="text-xs text-on-surface-variant">Loading students roster...</p>
          </div>
        ) : students.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <span className="material-symbols-outlined text-4xl text-outline-variant">person_search</span>
            <p className="text-sm font-semibold text-on-surface">No student records found</p>
            <p className="text-xs text-on-surface-variant">Try adjusting your search query or filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-surface-container-low text-on-surface-variant font-label-sm text-[11px] uppercase tracking-wider border-b border-surface-container-high/40">
                  <th className="py-3 px-4 font-bold">Student</th>
                  <th className="py-3 px-4 font-bold">Adm # / Roll</th>
                  <th className="py-3 px-4 font-bold">Class</th>
                  <th className="py-3 px-4 font-bold">Guardian & Contact</th>
                  <th className="py-3 px-4 font-bold">Attendance Rate</th>
                  <th className="py-3 px-4 font-bold">Fee Standing</th>
                  <th className="py-3 px-4 font-bold">Status</th>
                  <th className="py-3 px-4 font-bold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container-low">
                {students.map((st) => (
                  <tr key={st.id} className="hover:bg-surface-container-low/40 transition-colors">
                    {/* Student Avatar & Name */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-secondary/10 text-secondary flex items-center justify-center font-bold text-xs shrink-0">
                          {st.firstName.charAt(0)}
                          {st.lastName.charAt(0)}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <Link
                            href={`/admin/students/${st.id}`}
                            className="font-bold text-on-surface hover:text-secondary truncate"
                          >
                            {st.fullName}
                          </Link>
                          <span className="text-[10px] text-on-surface-variant capitalize">{st.gender}</span>
                        </div>
                      </div>
                    </td>

                    {/* Adm & Roll */}
                    <td className="py-3 px-4 font-mono">
                      <div className="font-semibold text-on-surface">{st.admissionNumber}</div>
                      <div className="text-[10px] text-on-surface-variant">Roll #{st.rollNumber}</div>
                    </td>

                    {/* Class */}
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded bg-surface-container font-semibold text-on-surface">
                        {st.className}
                      </span>
                    </td>

                    {/* Guardian Info */}
                    <td className="py-3 px-4">
                      <div className="font-medium text-on-surface">{st.guardianName}</div>
                      <div className="text-[10px] text-on-surface-variant">{st.guardianPhone}</div>
                    </td>

                    {/* Attendance */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`font-bold ${
                            st.attendanceRate >= 90
                              ? "text-on-tertiary-container"
                              : st.attendanceRate >= 75
                              ? "text-secondary"
                              : "text-error"
                          }`}
                        >
                          {st.attendanceRate}%
                        </span>
                      </div>
                    </td>

                    {/* Fee Status */}
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          st.feeStatus === "PAID"
                            ? "bg-tertiary-container/10 text-on-tertiary-container"
                            : st.feeStatus === "PARTIAL"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-error-container text-on-error-container"
                        }`}
                      >
                        {st.feeStatus}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          st.status === "ACTIVE"
                            ? "bg-surface-container-high text-on-surface"
                            : "bg-outline-variant/30 text-on-surface-variant"
                        }`}
                      >
                        {st.status}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openEditModal(st)}
                          className="p-1.5 rounded-lg hover:bg-surface-container text-secondary transition-colors"
                          title="Edit Student"
                          aria-label={`Edit ${st.fullName}`}
                        >
                          <span className="material-symbols-outlined text-[18px]">edit</span>
                        </button>
                        <Link
                          href={`/admin/students/${st.id}`}
                          className="p-1.5 rounded-lg hover:bg-surface-container text-secondary transition-colors"
                          title="View Student Dossier"
                          aria-label="View student dossier"
                        >
                          <span className="material-symbols-outlined text-[18px]">visibility</span>
                        </Link>
                        <button
                          type="button"
                          onClick={() => handleArchive(st.id, st.fullName)}
                          className="p-1.5 rounded-lg hover:bg-surface-container text-on-surface-variant hover:text-on-surface transition-colors"
                          title="Archive Student"
                          aria-label="Archive student"
                        >
                          <span className="material-symbols-outlined text-[18px]">archive</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteStudent(st.id, st.fullName)}
                          className="p-1.5 rounded-lg hover:bg-error-container text-on-surface-variant hover:text-error transition-colors"
                          title="Delete Student"
                          aria-label={`Delete ${st.fullName}`}
                        >
                          <span className="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit Student Modal */}
      {editModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-student-heading"
            className="bg-surface-container-lowest rounded-xl max-w-lg w-full p-5 shadow-2xl border border-surface-container-high space-y-4 max-h-[90vh] overflow-y-auto my-8"
          >
            <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
              <h3 id="edit-student-heading" className="font-headline-md text-sm font-bold text-on-surface">
                Edit Student Details
              </h3>
              <button
                type="button"
                onClick={() => setEditModalOpen(false)}
                className="text-on-surface-variant hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {editError && (
              <div className="p-2.5 rounded bg-error-container text-on-error-container text-xs flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px]">error</span>
                <span>{editError}</span>
              </div>
            )}

            <form onSubmit={handleSaveStudentEdit} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="modal-edit-st-first-name" className="block font-semibold text-on-surface mb-1">First Name *</label>
                  <input
                    id="modal-edit-st-first-name"
                    type="text"
                    required
                    value={editFormData.firstName}
                    onChange={(e) => setEditFormData({ ...editFormData, firstName: e.target.value })}
                    className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                  />
                </div>
                <div>
                  <label htmlFor="modal-edit-st-last-name" className="block font-semibold text-on-surface mb-1">Last Name</label>
                  <input
                    id="modal-edit-st-last-name"
                    type="text"
                    value={editFormData.lastName}
                    onChange={(e) => setEditFormData({ ...editFormData, lastName: e.target.value })}
                    className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                  />
                </div>
                <div>
                  <label htmlFor="modal-edit-st-gender" className="block font-semibold text-on-surface mb-1">Gender</label>
                  <select
                    id="modal-edit-st-gender"
                    value={editFormData.gender}
                    onChange={(e) => setEditFormData({ ...editFormData, gender: e.target.value })}
                    className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                  >
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="modal-edit-st-dob" className="block font-semibold text-on-surface mb-1">Date of Birth</label>
                  <input
                    id="modal-edit-st-dob"
                    type="date"
                    value={editFormData.dob}
                    onChange={(e) => setEditFormData({ ...editFormData, dob: e.target.value })}
                    className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                  />
                </div>
                <div>
                  <label htmlFor="modal-edit-st-class" className="block font-semibold text-on-surface mb-1">Class Cohort *</label>
                  <select
                    id="modal-edit-st-class"
                    required
                    value={editFormData.classId}
                    onChange={(e) => setEditFormData({ ...editFormData, classId: e.target.value })}
                    className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                  >
                    <option value="">Select Class</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.displayName || `${c.name}-${c.section}`}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="modal-edit-st-roll" className="block font-semibold text-on-surface mb-1">Roll Number</label>
                  <input
                    id="modal-edit-st-roll"
                    type="text"
                    value={editFormData.rollNumber}
                    onChange={(e) => setEditFormData({ ...editFormData, rollNumber: e.target.value })}
                    className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                  />
                </div>
                <div>
                  <label htmlFor="modal-edit-st-status" className="block font-semibold text-on-surface mb-1">Status</label>
                  <select
                    id="modal-edit-st-status"
                    value={editFormData.status}
                    onChange={(e) => setEditFormData({ ...editFormData, status: e.target.value })}
                    className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40 font-semibold"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="INACTIVE">INACTIVE</option>
                    <option value="ALUMNI">ALUMNI</option>
                    <option value="SUSPENDED">SUSPENDED</option>
                    <option value="WITHDRAWN">WITHDRAWN</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="modal-edit-st-contact" className="block font-semibold text-on-surface mb-1">Contact Phone</label>
                  <input
                    id="modal-edit-st-contact"
                    type="tel"
                    value={editFormData.contactNumber}
                    onChange={(e) => setEditFormData({ ...editFormData, contactNumber: e.target.value })}
                    className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                  />
                </div>
                <div>
                  <label htmlFor="modal-edit-st-guardian-name" className="block font-semibold text-on-surface mb-1">Guardian Name *</label>
                  <input
                    id="modal-edit-st-guardian-name"
                    type="text"
                    required
                    value={editFormData.guardianName}
                    onChange={(e) => setEditFormData({ ...editFormData, guardianName: e.target.value })}
                    className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                  />
                </div>
                <div>
                  <label htmlFor="modal-edit-st-guardian-phone" className="block font-semibold text-on-surface mb-1">Guardian Phone *</label>
                  <input
                    id="modal-edit-st-guardian-phone"
                    type="tel"
                    required
                    value={editFormData.guardianPhone}
                    onChange={(e) => setEditFormData({ ...editFormData, guardianPhone: e.target.value })}
                    className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-surface-container-low">
                <button
                  type="button"
                  onClick={() => setEditModalOpen(false)}
                  className="px-3 py-1.5 rounded bg-surface-container text-on-surface font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editLoading}
                  className="px-4 py-1.5 rounded bg-secondary text-on-secondary font-semibold hover:bg-secondary/90 disabled:opacity-50"
                >
                  {editLoading ? "Saving..." : "Update Student"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
