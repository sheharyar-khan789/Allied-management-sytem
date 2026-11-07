"use client";

import React, { useEffect, useState, use } from "react";
import { formatDisplayDate } from "@/lib/date-utils";
import Link from "next/link";
import FileUpload from "@/components/FileUpload";

export default function TeacherProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const id = resolvedParams.id;

  const [teacher, setTeacher] = useState<any>(null);
  const [availableClasses, setAvailableClasses] = useState<any[]>([]);
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [activeTab, setActiveTab] = useState<"overview" | "biodata" | "attendance" | "observations" | "documents">("overview");

  // Observations tab state
  const [observations, setObservations] = useState<any[] | null>(null);
  const [observationsError, setObservationsError] = useState("");
  const [observationsLoading, setObservationsLoading] = useState(false);

  // Attendance History tab state (current month only; full history/corrections on the
  // dedicated Teacher Attendance page this links to).
  const [attendanceData, setAttendanceData] = useState<any>(null);
  const [attendanceError, setAttendanceError] = useState("");
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [savingAccess, setSavingAccess] = useState(false);
  const [accessError, setAccessError] = useState("");
  const [accessSaved, setAccessSaved] = useState(false);

  // Base monthly salary state
  const [salaryInput, setSalaryInput] = useState<string>("");
  const [savingSalary, setSavingSalary] = useState(false);
  const [salarySaved, setSalarySaved] = useState(false);
  const [salaryError, setSalaryError] = useState("");

  // Document upload state
  const [docModalOpen, setDocModalOpen] = useState(false);
  const [docType, setDocType] = useState<"CERTIFICATE" | "EDUCATIONAL" | "PROFESSIONAL" | "PHOTO" | "OTHER">("CERTIFICATE");
  const [docName, setDocName] = useState("");
  const [docUrl, setDocUrl] = useState("");
  const [docSaving, setDocSaving] = useState(false);

  // Edit Profile modal state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editFormLoading, setEditFormLoading] = useState(false);
  const [editError, setEditError] = useState("");
  const [profileSuccess, setProfileSuccess] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetNotice, setResetNotice] = useState<{
    message: string;
    type: "success" | "warning" | "error";
    deliveryStatus?: string;
    channel?: string;
    canRetry?: boolean;
  } | null>(null);
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    designation: "",
    qualification: "",
    specialization: "",
    phone: "",
    email: "",
    username: "",
    photoUrl: "",
    status: "ACTIVE",
    baseSalary: "",
    joiningDate: "",
    endingDate: "",
  });

  const fetchTeacherData = () => {
    fetch(`/api/teachers/${id}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error || "Faculty profile could not be loaded.");
        }
        return json;
      })
      .then((json) => {
        setTeacher(json.teacher);
        setAvailableClasses(json.availableClasses || []);
        setSelectedClassIds(json.teacher?.assignedClassIds || []);
        setSalaryInput(String(json.teacher?.baseSalary ?? ""));
      })
      .catch((err: Error) => setLoadError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchTeacherData();
  }, [id]);

  // Lazy-loaded the first time the Observations tab is opened; this teacher's own notes only,
  // server-resolved by teacherId (GET /api/teacher-observations?teacherId=...) — same endpoint
  // the dedicated admin/teacher-observations screen uses, so it stays in sync with it.
  useEffect(() => {
    if (activeTab !== "observations" || observations !== null) return;
    setObservationsLoading(true);
    setObservationsError("");
    fetch(`/api/teacher-observations?teacherId=${encodeURIComponent(id)}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || "Could not load observations.");
        return json;
      })
      .then((json) => setObservations(json.observations || []))
      .catch((err: Error) => setObservationsError(err.message))
      .finally(() => setObservationsLoading(false));
  }, [activeTab, id, observations]);

  // Lazy-loaded the first time the Attendance History tab is opened; current month only, via
  // the Phase 11 Teacher Attendance API (GET /api/teacher-attendance?teacherId=...).
  useEffect(() => {
    if (activeTab !== "attendance" || attendanceData !== null) return;
    const now = new Date();
    setAttendanceLoading(true);
    setAttendanceError("");
    fetch(`/api/teacher-attendance?teacherId=${encodeURIComponent(id)}&year=${now.getFullYear()}&month=${now.getMonth() + 1}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || "Could not load attendance.");
        return json;
      })
      .then(setAttendanceData)
      .catch((err: Error) => setAttendanceError(err.message))
      .finally(() => setAttendanceLoading(false));
  }, [activeTab, id, attendanceData]);

  const handleAddDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docUrl || !docName) return;
    setDocSaving(true);
    try {
      const currentDocs = teacher?.documents || [];
      const newDoc = {
        id: `doc-${Date.now()}`,
        name: docName,
        type: docType,
        url: docUrl,
        uploadedAt: new Date().toISOString(),
      };
      const res = await fetch(`/api/teachers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documents: [...currentDocs, newDoc] }),
      });
      if (res.ok) {
        setDocModalOpen(false);
        setDocName("");
        setDocUrl("");
        fetchTeacherData();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setDocSaving(false);
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    if (!confirm("Are you sure you want to remove this attached document?")) return;
    try {
      const currentDocs = teacher?.documents || [];
      const updatedDocs = currentDocs.filter((d: any) => d.id !== docId);
      const res = await fetch(`/api/teachers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documents: updatedDocs }),
      });
      if (res.ok) fetchTeacherData();
    } catch (err) {
      console.error(err);
    }
  };

  const openEditModal = () => {
    const names = (teacher?.fullName || "").split(" ");
    setFormData({
      firstName: teacher?.firstName || names[0] || "",
      lastName: teacher?.lastName || names.slice(1).join(" ") || "",
      designation: teacher?.designation || "",
      qualification: teacher?.qualification || "",
      specialization: teacher?.specialization || teacher?.department || "",
      phone: teacher?.phone || "",
      email: teacher?.email || "",
      username: teacher?.username || "",
      photoUrl: teacher?.photoUrl || "",
      status: teacher?.status || "ACTIVE",
      baseSalary: String(teacher?.baseSalary ?? teacher?.salary ?? ""),
      joiningDate: teacher?.joiningDate || "",
      endingDate: teacher?.endingDate || "",
    });
    setEditError("");
    setEditModalOpen(true);
  };

  const handleResetPassword = async () => {
    if (!confirm(`Send password reset link to ${teacher?.email || "this teacher"}?`)) return;
    setResetLoading(true);
    setResetNotice(null);
    try {
      const res = await fetch(`/api/teachers/${id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to send password reset link.");
      }
      setResetNotice({
        type: "success",
        message: data.message || `Password reset link has been dispatched to ${data.email || teacher.email}.`,
      });
    } catch (err: any) {
      setResetNotice({
        type: "error",
        message: err.message || "Failed to send password reset link.",
      });
    } finally {
      setResetLoading(false);
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditError("");

    if (!formData.joiningDate) {
      setEditError("Joining Date is required.");
      return;
    }

    if (formData.endingDate && formData.joiningDate && formData.endingDate < formData.joiningDate) {
      setEditError("Ending Date cannot be earlier than Joining Date.");
      return;
    }

    setEditFormLoading(true);
    try {
      const res = await fetch(`/api/teachers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update teacher profile.");
      }
      setEditModalOpen(false);
      setProfileSuccess("Faculty profile and login account updated successfully.");
      fetchTeacherData();
    } catch (err: any) {
      setEditError(err.message || "Failed to update profile.");
    } finally {
      setEditFormLoading(false);
    }
  };

  const toggleClass = (classId: string) => {
    setAccessSaved(false);
    setSelectedClassIds((prev) =>
      prev.includes(classId) ? prev.filter((c) => c !== classId) : [...prev, classId]
    );
  };

  const saveClassAccess = async () => {
    setAccessError("");
    setAccessSaved(false);
    setSavingAccess(true);
    try {
      const res = await fetch(`/api/teachers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedClassIds: selectedClassIds }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to update class access.");
      }
      setTeacher((prev: any) => ({ ...prev, assignedClassIds: selectedClassIds }));
      setAccessSaved(true);
    } catch (err: any) {
      setAccessError(err.message);
    } finally {
      setSavingAccess(false);
    }
  };

  const saveSalary = async () => {
    setSalaryError("");
    setSalarySaved(false);
    setSavingSalary(true);
    try {
      const parsed = Number(salaryInput);
      if (isNaN(parsed) || parsed < 0) {
        throw new Error("Please enter a valid non-negative salary amount.");
      }
      const res = await fetch(`/api/teachers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseSalary: parsed }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to update salary.");
      }
      setTeacher((prev: any) => ({ ...prev, baseSalary: parsed }));
      setSalarySaved(true);
      setTimeout(() => setSalarySaved(false), 3000);
    } catch (err: any) {
      setSalaryError(err.message);
    } finally {
      setSavingSalary(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <div className="w-10 h-10 border-4 border-secondary border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs text-on-surface-variant">Loading teacher profile...</p>
      </div>
    );
  }

  if (!teacher) {
    return (
      <div className="p-8 text-center space-y-3">
        <p className="text-sm font-semibold text-error">
          {loadError || "Faculty profile not found"}
        </p>
        <Link href="/admin/teachers" className="text-xs text-secondary hover:underline">
          ← Back to Teachers Directory
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full gap-space-lg">
      {profileSuccess && (
        <div
          role="status"
          className="p-4 rounded-xl border bg-tertiary-container/10 border-on-tertiary-container/30 flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-on-tertiary-container">check_circle</span>
            <p className="text-xs font-semibold text-on-surface">{profileSuccess}</p>
          </div>
          <button
            type="button"
            onClick={() => setProfileSuccess("")}
            className="text-on-surface-variant hover:text-on-surface"
            aria-label="Dismiss notice"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      )}

      {resetNotice && (
        <div
          role="status"
          className={`p-4 rounded-xl border flex items-center justify-between ${
            resetNotice.type === "success"
              ? "bg-tertiary-container/10 border-on-tertiary-container/30 text-on-surface"
              : "bg-error-container/20 border-error/30 text-error"
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px]">
              {resetNotice.type === "success" ? "check_circle" : "error"}
            </span>
            <p className="text-xs font-semibold">{resetNotice.message}</p>
          </div>
          <button
            type="button"
            onClick={() => setResetNotice(null)}
            className="text-on-surface-variant hover:text-on-surface"
            aria-label="Dismiss notice"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      )}

      {/* Teacher Profile Banner */}
      <div className="p-6 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          {teacher.photoUrl ? (
            <img
              src={teacher.photoUrl}
              alt={`${teacher.firstName} ${teacher.lastName}`}
              className="w-16 h-16 rounded-xl object-cover border border-surface-container-high shadow-md shrink-0"
              onError={(e) => {
                (e.currentTarget as HTMLElement).style.display = "none";
              }}
            />
          ) : (
            <div className="w-16 h-16 rounded-xl bg-primary text-white flex items-center justify-center font-headline-lg text-2xl font-bold shadow-md shrink-0">
              {teacher.firstName.charAt(0)}
              {teacher.lastName.charAt(0)}
            </div>
          )}
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-headline-lg text-2xl font-bold text-on-surface">
                {teacher.firstName} {teacher.lastName}
              </h1>
              <span className="px-2.5 py-0.5 rounded-full bg-secondary/10 text-secondary font-label-sm text-xs font-bold font-mono">
                {teacher.employeeId}
              </span>
              <span className={`px-2.5 py-0.5 rounded-full font-label-sm text-xs font-bold ${
                teacher.status === "ACTIVE"
                  ? "bg-tertiary-container/10 text-on-tertiary-container"
                  : "bg-error-container/20 text-error"
              }`}>
                {teacher.status}
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-surface-container font-label-sm text-xs font-semibold text-on-surface">
                Joined: {teacher.joiningDate ? formatDisplayDate(teacher.joiningDate) : "Not Specified"}
              </span>
              {teacher.endingDate && (
                <span className="px-2.5 py-0.5 rounded-full bg-error-container/20 text-error font-label-sm text-xs font-semibold">
                  Left: {formatDisplayDate(teacher.endingDate)}
                </span>
              )}
              <span className="px-2.5 py-0.5 rounded-full bg-surface-container font-label-sm text-xs font-bold text-on-surface font-mono">
                Salary: {teacher.baseSalary ? `Rs. ${Number(teacher.baseSalary).toLocaleString()}` : "Unset"}
              </span>
            </div>
            <p className="font-body-md text-xs text-on-surface-variant font-medium">
              {teacher.designation} • {teacher.qualification} • {teacher.phone} • {teacher.email}
              {teacher.username ? ` • @${teacher.username}` : " • no login username yet"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openEditModal}
            className="px-4 py-2 rounded-lg bg-secondary text-on-secondary font-semibold text-xs hover:bg-secondary/90 shadow-sm flex items-center gap-1.5 transition-all"
          >
            <span className="material-symbols-outlined text-[18px]">edit</span>
            <span>Edit Profile</span>
          </button>
          <Link
            href="/admin/teachers"
            className="px-4 py-2 rounded-lg bg-surface-container text-on-surface font-semibold text-xs hover:bg-surface-container-high shadow-sm flex items-center gap-1.5 transition-all"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            <span>Back to Directory</span>
          </Link>
        </div>
      </div>

      {/* Profile Navigation Tabs */}
      <div className="border-b border-surface-container-high/60 flex space-x-2 sm:space-x-4 overflow-x-auto no-print">
        {[
          { key: "overview", label: "Overview", icon: "dashboard" },
          { key: "biodata", label: "Bio Data", icon: "badge" },
          { key: "attendance", label: "Attendance History", icon: "calendar_today" },
          { key: "observations", label: "Observations", icon: "psychology" },
          { key: "documents", label: "Documents & Files", icon: "folder_open" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`flex items-center gap-1.5 py-3 px-3 text-xs sm:text-sm font-semibold border-b-2 transition-all whitespace-nowrap ${
              activeTab === tab.key
                ? "border-secondary text-secondary font-bold"
                : "border-transparent text-on-surface-variant hover:text-on-surface"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab: Overview */}
      {activeTab === "overview" && (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Taught Subjects & Classes */}
        <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-4">
          <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
            <h3 className="font-headline-md text-sm font-bold text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary text-[18px]">menu_book</span>
              Assigned Subjects & Classes
            </h3>
            <span className="px-2 py-0.5 rounded bg-surface-container text-xs font-bold text-secondary">
              {teacher.taughtSubjects?.length || 0} Allocations
            </span>
          </div>

          {(!teacher.taughtSubjects || teacher.taughtSubjects.length === 0) ? (
            <div className="py-6 px-4 rounded-lg bg-surface-container-low/50 border border-dashed border-outline-variant/40 text-center">
              <p className="text-xs text-on-surface-variant italic">No subjects assigned</p>
              <p className="text-[10px] text-on-surface-variant mt-1">
                Assign this educator to curriculum subjects from the Classes & Curriculum section.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {teacher.taughtSubjects.map((sub: any) => (
                <div
                  key={sub.id}
                  className="p-3 rounded-lg bg-surface-container-low/60 border border-surface-container-high/40 flex items-center justify-between text-xs"
                >
                  <div>
                    <div className="font-bold text-on-surface">{sub.name}</div>
                    <div className="text-[10px] text-on-surface-variant font-mono">Code: {sub.code}</div>
                  </div>
                  <span className="px-2 py-1 rounded bg-surface-container font-semibold text-primary">
                    {sub.class?.displayName || `${sub.class?.name}-${sub.class?.section}`}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Class Incharge Assignment */}
          {teacher.managedClasses && teacher.managedClasses.length > 0 && (
            <div className="pt-2 border-t border-surface-container-low">
              <span className="text-[10px] uppercase font-bold text-on-surface-variant tracking-wider">
                Class Incharge / Class Teacher
              </span>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {teacher.managedClasses.map((cls: any) => (
                  <span
                    key={cls.id}
                    className="px-2.5 py-1 rounded-lg bg-secondary/10 text-secondary font-semibold text-xs flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-[14px]">school</span>
                    <span>{cls.displayName || `${cls.name}-${cls.section}`}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Class Access Control */}
        <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-4">
          <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
            <h3 className="font-headline-md text-sm font-bold text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary text-[18px]">lock_person</span>
              Class Access
            </h3>
            <span className="px-2 py-0.5 rounded bg-surface-container text-xs font-bold text-secondary">
              {selectedClassIds.length} Assigned
            </span>
          </div>

          <p className="text-[11px] leading-relaxed text-on-surface-variant">
            Controls which classes this teacher can take attendance for, enter marks for, write
            observations on, and view students in.
          </p>

          {selectedClassIds.length === 0 && (
            <div
              role="status"
              className="p-3 rounded-lg bg-error-container/20 border border-error/30 text-[11px] leading-relaxed text-on-error-container"
            >
              <span className="font-bold">No classes assigned.</span> While this list is empty
              this teacher is <span className="font-bold">unrestricted</span> and can access every
              class in the school. Select the classes they actually teach to limit their access.
            </div>
          )}

          <fieldset className="space-y-2 max-h-72 overflow-y-auto">
            <legend className="sr-only">Classes this teacher may access</legend>
            {availableClasses.length === 0 ? (
              <p className="text-xs text-on-surface-variant py-2">
                No classes have been created for this school yet.
              </p>
            ) : (
              availableClasses.map((cls: any) => {
                const inputId = `class-access-${cls.id}`;
                return (
                  <div
                    key={cls.id}
                    className="flex items-center gap-2.5 p-2.5 rounded-lg bg-surface-container-low/60 border border-surface-container-high/40"
                  >
                    <input
                      id={inputId}
                      type="checkbox"
                      checked={selectedClassIds.includes(cls.id)}
                      onChange={() => toggleClass(cls.id)}
                      className="h-4 w-4 shrink-0 accent-secondary"
                    />
                    <label
                      htmlFor={inputId}
                      className="text-xs font-semibold text-on-surface cursor-pointer"
                    >
                      {cls.displayName}
                    </label>
                  </div>
                );
              })
            )}
          </fieldset>

          {accessError && (
            <div role="alert" className="p-2.5 rounded bg-error-container text-on-error-container text-xs flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px]">error</span>
              <span>{accessError}</span>
            </div>
          )}
          {accessSaved && (
            <div role="status" className="p-2.5 rounded bg-tertiary-container/20 text-on-tertiary-container text-xs flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px]">check_circle</span>
              <span>Class access updated.</span>
            </div>
          )}

          <div className="flex justify-end pt-2 border-t border-surface-container-low">
            <button
              type="button"
              onClick={saveClassAccess}
              disabled={savingAccess || availableClasses.length === 0}
              className="px-4 py-1.5 rounded bg-secondary text-on-secondary font-semibold text-xs hover:bg-secondary/90 disabled:opacity-50"
            >
              {savingAccess ? "Saving..." : "Save Class Access"}
            </button>
          </div>
        </div>

        {/* Monthly Compensation & Payroll */}
        <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-4 md:col-span-2">
          <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
            <h3 className="font-headline-md text-sm font-bold text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary text-[18px]">account_balance_wallet</span>
              Monthly Salary & Compensation
            </h3>
            <span className="px-2.5 py-0.5 rounded bg-secondary/10 text-secondary text-xs font-bold font-mono">
              {teacher.baseSalary ? `Rs. ${Number(teacher.baseSalary).toLocaleString()}` : "Not Set"}
            </span>
          </div>

          <p className="text-[11px] leading-relaxed text-on-surface-variant">
            Set the base monthly compensation for this educator. This salary amount is used by the Payroll module to generate and track monthly disbursements.
          </p>

          <div className="max-w-md space-y-2">
            <label htmlFor="teacher-profile-salary" className="block text-xs font-semibold text-on-surface">
              Base Monthly Salary (PKR)
            </label>
            <div className="flex items-center gap-2">
              <input
                id="teacher-profile-salary"
                type="number"
                min="0"
                step="500"
                value={salaryInput}
                onChange={(e) => {
                  setSalarySaved(false);
                  setSalaryInput(e.target.value);
                }}
                placeholder="e.g. 60000"
                className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-xs font-bold text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20"
              />
              <button
                type="button"
                onClick={saveSalary}
                disabled={savingSalary}
                className="px-4 py-2 rounded-lg bg-secondary text-on-secondary font-semibold text-xs hover:bg-secondary/90 disabled:opacity-50 shrink-0"
              >
                {savingSalary ? "Saving..." : "Save Salary"}
              </button>
            </div>
          </div>

          {salaryError && (
            <div role="alert" className="p-2.5 rounded bg-error-container text-on-error-container text-xs flex items-center gap-2 max-w-md">
              <span className="material-symbols-outlined text-[16px]">error</span>
              <span>{salaryError}</span>
            </div>
          )}
          {salarySaved && (
            <div role="status" className="p-2.5 rounded bg-tertiary-container/20 text-on-tertiary-container text-xs flex items-center gap-2 max-w-md">
              <span className="material-symbols-outlined text-[16px]">check_circle</span>
              <span>Base monthly salary updated successfully.</span>
            </div>
          )}
        </div>
      </div>
      )}

      {/* Tab: Bio Data */}
      {activeTab === "biodata" && (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Personal & Professional Information */}
        <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-4 md:col-span-2">
          <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
            <h3 className="font-headline-md text-sm font-bold text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary text-[18px]">contact_page</span>
              Personal &amp; Professional Information
            </h3>
            <button
              type="button"
              onClick={openEditModal}
              className="px-3 py-1.5 rounded-lg bg-surface-container text-on-surface font-semibold text-xs hover:bg-surface-container-high flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[16px]">edit</span>
              <span>Edit</span>
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-xs">
            {[
              { label: "Full Name", value: `${teacher.firstName} ${teacher.lastName}`.trim() },
              { label: "Employee ID", value: teacher.employeeId },
              { label: "Designation", value: teacher.designation || "Not Specified" },
              { label: "Qualification", value: teacher.qualification || "Not Specified" },
              { label: "Specialization / Department", value: teacher.specialization || "Not Specified" },
              { label: "Phone", value: teacher.phone || "Not Specified" },
              { label: "Email", value: teacher.email || "Not Specified" },
              { label: "Login Username", value: teacher.username ? `@${teacher.username}` : "Not assigned yet" },
            ].map((f) => (
              <div key={f.label} className="p-3 rounded-lg bg-surface-container-low/60 border border-surface-container-high/40">
                <div className="text-[10px] text-on-surface-variant font-bold uppercase tracking-wider">{f.label}</div>
                <div className="font-semibold text-on-surface text-sm mt-1 break-words">{f.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Employment & Tenure Record */}
        <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-4 md:col-span-2">
          <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
            <h3 className="font-headline-md text-sm font-bold text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary text-[18px]">badge</span>
              Employment & Service History
            </h3>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
              teacher.status === "ACTIVE"
                ? "bg-tertiary-container/10 text-on-tertiary-container"
                : "bg-error-container/20 text-error"
            }`}>
              {teacher.status === "ACTIVE" ? "Currently Active" : "Former Faculty"}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div className="p-3 rounded-lg bg-surface-container-low/60 border border-surface-container-high/40">
              <div className="text-[10px] text-on-surface-variant font-bold uppercase tracking-wider">Joining Date</div>
              <div className="font-semibold text-on-surface text-sm mt-1">
                {teacher.joiningDate ? formatDisplayDate(teacher.joiningDate) : "Not Specified"}
              </div>
              <div className="text-[10px] text-on-surface-variant mt-0.5">Official appointment date</div>
            </div>

            <div className="p-3 rounded-lg bg-surface-container-low/60 border border-surface-container-high/40">
              <div className="text-[10px] text-on-surface-variant font-bold uppercase tracking-wider">Ending Date / Leaving Date</div>
              <div className={`font-semibold text-sm mt-1 ${teacher.endingDate ? "text-error" : "text-secondary"}`}>
                {teacher.endingDate || "None (Currently Active)"}
              </div>
              <div className="text-[10px] text-on-surface-variant mt-0.5">
                {teacher.endingDate ? "Date of departure from school" : "Active educator on roster"}
              </div>
            </div>

            <div className="p-3 rounded-lg bg-surface-container-low/60 border border-surface-container-high/40">
              <div className="text-[10px] text-on-surface-variant font-bold uppercase tracking-wider">Record Status</div>
              <div className="font-semibold text-on-surface text-sm mt-1">
                {teacher.endingDate ? "Preserved (Inactive)" : "Active Roster"}
              </div>
              <div className="text-[10px] text-on-surface-variant mt-0.5">
                Historical records, classes, and marks retained
              </div>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Tab: Attendance History */}
      {activeTab === "attendance" && (
      <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-4">
        <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
          <h3 className="font-headline-md text-sm font-bold text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined text-secondary text-[18px]">calendar_today</span>
            Attendance — Current Month
          </h3>
          <Link
            href={`/admin/teacher-attendance?teacherId=${encodeURIComponent(id)}`}
            className="px-3 py-1.5 rounded-lg bg-secondary text-on-secondary font-semibold text-xs hover:bg-secondary/90 flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">calendar_month</span>
            <span>Full History &amp; Corrections</span>
          </Link>
        </div>

        {attendanceLoading ? (
          <p className="text-xs text-on-surface-variant py-4 text-center">Loading attendance...</p>
        ) : attendanceError ? (
          <div className="p-2.5 rounded bg-error-container text-on-error-container text-xs">{attendanceError}</div>
        ) : attendanceData ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              {[
                { label: "Working Days", value: attendanceData.summary.workingDays, cls: "" },
                { label: "Present", value: attendanceData.summary.present, cls: "text-tertiary" },
                { label: "Leave", value: attendanceData.summary.leave, cls: "text-secondary" },
                { label: "Absent", value: attendanceData.summary.absent, cls: "text-error" },
              ].map((s) => (
                <div key={s.label} className="p-3 rounded-lg bg-surface-container-low/60 border border-surface-container-high/40">
                  <div className="text-[10px] text-on-surface-variant font-bold uppercase tracking-wider">{s.label}</div>
                  <div className={`text-xl font-bold mt-1 ${s.cls || "text-on-surface"}`}>{s.value}</div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-on-surface-variant">
              Working days exclude Sundays and configured holidays. One allowed leave day per week; a second leave
              day in the same week counts as absent. A real biometric check-in always counts as present. No
              attendance data is fabricated — a day with no saved record counts as absent.
            </p>
          </>
        ) : null}
      </div>
      )}

      {/* Tab: Observations */}
      {activeTab === "observations" && (
      <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-4">
        <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
          <h3 className="font-headline-md text-sm font-bold text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined text-secondary text-[18px]">psychology</span>
            Observations
          </h3>
          <Link
            href={`/admin/teacher-observations?teacherId=${encodeURIComponent(id)}`}
            className="px-3 py-1.5 rounded-lg bg-secondary text-on-secondary font-semibold text-xs hover:bg-secondary/90 flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">fact_check</span>
            <span>Add / Manage</span>
          </Link>
        </div>
        <p className="text-xs text-on-surface-variant -mt-2">
          Admin evaluation notes written about this teacher — this teacher can see only their own notes from their
          own portal; another teacher can never see these.
        </p>

        {observationsLoading ? (
          <p className="text-xs text-on-surface-variant py-4 text-center">Loading observations...</p>
        ) : observationsError ? (
          <div className="p-2.5 rounded bg-error-container text-on-error-container text-xs">{observationsError}</div>
        ) : !observations || observations.length === 0 ? (
          <div className="p-8 rounded-xl bg-surface-container-low/60 border border-dashed border-outline-variant text-center">
            <p className="text-xs font-semibold text-on-surface">No observations recorded yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {observations.map((o: any) => (
              <div key={o.id} className="p-3 rounded-lg bg-surface-container-low/60 border border-surface-container-high/40 text-xs space-y-1">
                <div className="flex items-center justify-between flex-wrap gap-1">
                  <span className="font-bold text-on-surface">{o.title || o.category}</span>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-secondary/10 text-secondary font-semibold">{o.category}</span>
                    <span className="px-2 py-0.5 rounded bg-surface-container font-semibold">{o.rating}</span>
                    <span className="text-on-surface-variant">{formatDisplayDate(o.observationDate)}</span>
                  </div>
                </div>
                <p className="text-on-surface-variant whitespace-pre-wrap">{o.note}</p>
                <p className="text-[10px] text-on-surface-variant">By {o.authorName || "Administration"}</p>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* Tab: Documents */}
      {activeTab === "documents" && (
      <>
      {/* Documents */}
      <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-4">
        <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
          <h3 className="font-headline-md text-sm font-bold text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined text-secondary text-[18px]">folder_open</span>
            Documents &amp; Files
          </h3>
          <button
            onClick={() => setDocModalOpen(true)}
            className="px-3.5 py-2 rounded-lg bg-secondary text-on-secondary text-xs font-semibold flex items-center gap-1.5 hover:bg-secondary/90 shadow-sm"
          >
            <span className="material-symbols-outlined text-[18px]">upload_file</span>
            <span>Upload Document</span>
          </button>
        </div>
        <p className="text-xs text-on-surface-variant font-medium -mt-2">
          Qualification certificates, professional/educational records, passport photo, and other authorized files.
        </p>

        {(!teacher.documents || teacher.documents.length === 0) ? (
          <div className="p-8 rounded-xl bg-surface-container-low/60 border border-dashed border-outline-variant text-center space-y-2">
            <span className="material-symbols-outlined text-4xl text-on-surface-variant">inventory_2</span>
            <p className="text-xs font-semibold text-on-surface">No documents uploaded yet</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {teacher.documents.map((doc: any) => (
              <div
                key={doc.id}
                className="p-4 rounded-xl bg-surface-container-low/60 shadow-sm border border-surface-container-high/40 flex flex-col justify-between space-y-3"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-surface-container flex items-center justify-center shrink-0 text-secondary">
                    <span className="material-symbols-outlined text-[22px]">
                      {doc.url?.includes(".pdf") ? "picture_as_pdf" : "description"}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-secondary/10 text-secondary">
                      {doc.type.replace(/_/g, " ")}
                    </span>
                    <h5 className="font-semibold text-xs text-on-surface truncate mt-1" title={doc.name}>
                      {doc.name}
                    </h5>
                    <p className="text-[10px] text-on-surface-variant mt-0.5">Uploaded {formatDisplayDate(doc.uploadedAt)}</p>
                  </div>
                </div>
                <div className="pt-2 border-t border-surface-container-low flex items-center justify-between">
                  <a href={doc.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-secondary hover:underline">
                    <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                    <span>View File</span>
                  </a>
                  <button
                    type="button"
                    onClick={() => handleDeleteDocument(doc.id)}
                    className="p-1 text-on-surface-variant hover:text-error rounded-md transition-colors"
                    title="Delete document"
                  >
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Document Upload Modal */}
      {docModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="attach-teacher-document-heading"
            className="bg-surface-container-lowest rounded-xl max-w-md w-full p-5 shadow-2xl border border-surface-container-high space-y-4 my-8"
          >
            <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
              <h3 id="attach-teacher-document-heading" className="font-headline-md text-sm font-bold text-on-surface">
                Upload Faculty Document
              </h3>
              <button
                onClick={() => { setDocModalOpen(false); setDocUrl(""); setDocName(""); }}
                className="text-on-surface-variant hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <form onSubmit={handleAddDocument} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-on-surface mb-1">Document Category *</label>
                <select
                  value={docType}
                  onChange={(e) => setDocType(e.target.value as any)}
                  className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40"
                >
                  <option value="CERTIFICATE">Qualification Certificate</option>
                  <option value="EDUCATIONAL">Educational Document</option>
                  <option value="PROFESSIONAL">Professional Document</option>
                  <option value="PHOTO">Passport-size Photograph</option>
                  <option value="OTHER">Other Authorized Document</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-on-surface mb-1">Document Title / Label *</label>
                <input
                  type="text"
                  required
                  value={docName}
                  onChange={(e) => setDocName(e.target.value)}
                  placeholder="e.g. M.Ed Degree Certificate"
                  className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20"
                />
              </div>

              <FileUpload
                folder="documents"
                label="Select File to Upload *"
                helperText="Upload PDF, JPG or PNG (up to 10MB)"
                currentUrl={docUrl}
                onUploadComplete={(url, meta) => {
                  setDocUrl(url);
                  if (!docName && meta?.filename) {
                    setDocName(meta.filename.replace(/\.[^/.]+$/, ""));
                  }
                }}
                onRemove={() => setDocUrl("")}
                previewType="file"
              />

              <div className="flex justify-end gap-2 pt-2 border-t border-surface-container-low">
                <button
                  type="button"
                  onClick={() => { setDocModalOpen(false); setDocUrl(""); setDocName(""); }}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-on-surface-variant hover:bg-surface-container-low"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={docSaving || !docUrl || !docName}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-secondary text-on-secondary hover:bg-secondary/90 disabled:opacity-50"
                >
                  {docSaving ? "Saving..." : "Upload Document"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      </>
      )}

      {/* Edit Teacher Modal */}
      {editModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-faculty-heading"
            className="bg-surface-container-lowest rounded-xl max-w-lg w-full p-5 shadow-2xl border border-surface-container-high space-y-4 max-h-[90vh] overflow-y-auto my-8"
          >
            <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
              <h3 id="edit-faculty-heading" className="font-headline-md text-sm font-bold text-on-surface">
                Edit Faculty Profile
              </h3>
              <button
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

            <form onSubmit={handleUpdateProfile} className="space-y-3 text-xs">
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
                  <label htmlFor="teacher-profile-first-name" className="block font-semibold text-on-surface mb-1">First Name *</label>
                  <input
                    id="teacher-profile-first-name"
                    type="text"
                    required
                    value={formData.firstName}
                    onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                    className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                  />
                </div>
                <div>
                  <label htmlFor="teacher-profile-last-name" className="block font-semibold text-on-surface mb-1">Last Name *</label>
                  <input
                    id="teacher-profile-last-name"
                    type="text"
                    required
                    value={formData.lastName}
                    onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                    className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                  />
                </div>
                <div>
                  <label htmlFor="teacher-profile-username" className="block font-semibold text-on-surface mb-1">Login Username</label>
                  <input
                    id="teacher-profile-username"
                    type="text"
                    maxLength={30}
                    autoCapitalize="none"
                    autoComplete="off"
                    spellCheck={false}
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value.toLowerCase().replace(/\s/g, "") })}
                    placeholder="e.g. ali.teacher01"
                    className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40 font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="teacher-profile-email" className="block font-semibold text-on-surface mb-1">Email *</label>
                  <input
                    id="teacher-profile-email"
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                  />
                </div>
                <div>
                  <label htmlFor="teacher-profile-phone" className="block font-semibold text-on-surface mb-1">Phone *</label>
                  <input
                    id="teacher-profile-phone"
                    type="tel"
                    required
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                  />
                </div>
                <div>
                  <label htmlFor="teacher-profile-designation" className="block font-semibold text-on-surface mb-1">Designation</label>
                  <input
                    id="teacher-profile-designation"
                    type="text"
                    value={formData.designation}
                    onChange={(e) => setFormData({ ...formData, designation: e.target.value })}
                    placeholder="e.g. Senior Teacher"
                    className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                  />
                </div>
                <div>
                  <label htmlFor="teacher-profile-qualification" className="block font-semibold text-on-surface mb-1">Qualification</label>
                  <input
                    id="teacher-profile-qualification"
                    type="text"
                    value={formData.qualification}
                    onChange={(e) => setFormData({ ...formData, qualification: e.target.value })}
                    placeholder="e.g. M.Sc, B.Ed"
                    className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                  />
                </div>
                <div>
                  <label htmlFor="teacher-profile-specialization" className="block font-semibold text-on-surface mb-1">Specialization</label>
                  <input
                    id="teacher-profile-specialization"
                    type="text"
                    value={formData.specialization}
                    onChange={(e) => setFormData({ ...formData, specialization: e.target.value })}
                    placeholder="e.g. Mathematics"
                    className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                  />
                </div>
                <div>
                  <label htmlFor="teacher-profile-status" className="block font-semibold text-on-surface mb-1">Status</label>
                  <select
                    id="teacher-profile-status"
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                    className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                  >
                    <option value="ACTIVE">Active</option>
                    <option value="INACTIVE">Inactive</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="teacher-profile-joining-date" className="block font-semibold text-on-surface mb-1">
                    Joining Date *
                  </label>
                  <input
                    id="teacher-profile-joining-date"
                    type="date"
                    required
                    value={formData.joiningDate}
                    onChange={(e) => setFormData({ ...formData, joiningDate: e.target.value })}
                    className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                  />
                </div>
                <div>
                  <label htmlFor="teacher-profile-ending-date" className="block font-semibold text-on-surface mb-1">
                    Ending Date / Leaving Date
                  </label>
                  <input
                    id="teacher-profile-ending-date"
                    type="date"
                    value={formData.endingDate}
                    onChange={(e) => {
                      const newEnding = e.target.value;
                      setFormData({
                        ...formData,
                        endingDate: newEnding,
                        status: newEnding ? "INACTIVE" : formData.status,
                      });
                    }}
                    className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                  />
                </div>
                {formData.endingDate && (
                  <div className="col-span-2 p-2 rounded bg-surface-container-low text-[11px] text-on-surface-variant">
                    Setting an ending date records that this educator has departed while preserving all past gradebook, attendance, and assignment history intact.
                  </div>
                )}
                <div className="col-span-2">
                  <label htmlFor="teacher-profile-salary" className="block font-semibold text-on-surface mb-1">Base Monthly Salary (PKR)</label>
                  <input
                    id="teacher-profile-salary"
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
                  onClick={() => setEditModalOpen(false)}
                  className="px-3 py-1.5 rounded bg-surface-container text-on-surface font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editFormLoading}
                  className="px-4 py-1.5 rounded bg-secondary text-on-secondary font-semibold hover:bg-secondary/90 disabled:opacity-50"
                >
                  {editFormLoading ? "Saving..." : "Update Profile"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
