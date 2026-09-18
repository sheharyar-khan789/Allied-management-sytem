"use client";

import React, { useEffect, useState, use } from "react";
import Link from "next/link";
import { formatCurrency, formatDate } from "@/lib/utils";
import FileUpload from "@/components/FileUpload";

export default function StudentDossierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const id = resolvedParams.id;

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "attendance" | "fees" | "exams" | "conduct" | "documents">("overview");

  // Document upload state
  const [docModalOpen, setDocModalOpen] = useState(false);
  const [docType, setDocType] = useState<"ID_CARD" | "CERTIFICATE" | "ADMISSION_FORM" | "OTHER">("ID_CARD");
  const [docName, setDocName] = useState("");
  const [docUrl, setDocUrl] = useState("");
  const [docSaving, setDocSaving] = useState(false);
  const [photoSaving, setPhotoSaving] = useState(false);

  // Payment modal state
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [selectedChallan, setSelectedChallan] = useState<any>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("Bank Deposit");
  const [payLoading, setPayLoading] = useState(false);

  // Observation note modal state
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteCategory, setNoteCategory] = useState("ACADEMIC");
  const [noteContent, setNoteContent] = useState("");
  const [noteLoading, setNoteLoading] = useState(false);

  const fetchStudentDossier = async () => {
    try {
      const res = await fetch(`/api/students/${id}`);
      const json = await res.json();
      if (json.success) {
        setData(json);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStudentDossier();
  }, [id]);

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedChallan || !payAmount) return;
    setPayLoading(true);

    try {
      const res = await fetch("/api/fees", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challanId: selectedChallan.id,
          amount: Number(payAmount),
          paymentMethod: payMethod,
        }),
      });

      if (res.ok) {
        setPaymentModalOpen(false);
        fetchStudentDossier();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setPayLoading(false);
    }
  };

  const handleAddObservation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteTitle || !noteContent) return;
    setNoteLoading(true);

    try {
      const res = await fetch("/api/observations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: id,
          title: noteTitle,
          category: noteCategory,
          content: noteContent,
        }),
      });

      if (res.ok) {
        setNoteModalOpen(false);
        setNoteTitle("");
        setNoteContent("");
        fetchStudentDossier();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setNoteLoading(false);
    }
  };

  const handleUpdatePhoto = async (photoUrl: string) => {
    setPhotoSaving(true);
    try {
      const res = await fetch(`/api/students/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoUrl }),
      });
      if (res.ok) {
        fetchStudentDossier();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setPhotoSaving(false);
    }
  };

  const handleAddDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docUrl || !docName) return;
    setDocSaving(true);

    try {
      const currentDocs = data?.student?.documents || [];
      const newDoc = {
        id: `doc-${Date.now()}`,
        name: docName,
        type: docType,
        url: docUrl,
        uploadedAt: new Date().toISOString(),
      };
      const updatedDocs = [...currentDocs, newDoc];

      const res = await fetch(`/api/students/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documents: updatedDocs }),
      });

      if (res.ok) {
        setDocModalOpen(false);
        setDocName("");
        setDocUrl("");
        fetchStudentDossier();
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
      const currentDocs = data?.student?.documents || [];
      const updatedDocs = currentDocs.filter((d: any) => d.id !== docId);

      const res = await fetch(`/api/students/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documents: updatedDocs }),
      });

      if (res.ok) {
        fetchStudentDossier();
      }
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <div className="w-10 h-10 border-4 border-secondary border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs text-on-surface-variant">Loading student dossier...</p>
      </div>
    );
  }

  if (!data?.student) {
    return (
      <div className="p-8 text-center space-y-3">
        <p className="text-sm font-semibold text-error">Student record not found</p>
        <Link href="/admin/students" className="text-xs text-secondary hover:underline">
          ← Back to Students Directory
        </Link>
      </div>
    );
  }

  const { student, stats } = data;

  return (
    <div className="flex flex-col w-full gap-space-lg">
      {/* Student Dossier Profile Banner */}
      <div className="p-6 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          {student.photoUrl ? (
            <img
              src={student.photoUrl}
              alt={`${student.firstName} ${student.lastName}`}
              className="w-16 h-16 rounded-xl object-cover border border-surface-container-high shadow-md shrink-0"
              onError={(e) => {
                (e.currentTarget as HTMLElement).style.display = "none";
              }}
            />
          ) : (
            <div className="w-16 h-16 rounded-xl bg-secondary text-white flex items-center justify-center font-headline-lg text-2xl font-bold shadow-md shrink-0">
              {student.firstName.charAt(0)}
              {student.lastName.charAt(0)}
            </div>
          )}
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-headline-lg text-2xl font-bold text-on-surface">
                {student.firstName} {student.lastName}
              </h1>
              <span className="px-2.5 py-0.5 rounded-full bg-secondary/10 text-secondary font-label-sm text-xs font-bold">
                {student.admissionNumber}
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-tertiary-container/10 text-on-tertiary-container font-label-sm text-xs font-bold">
                {student.status}
              </span>
            </div>
            <p className="font-body-md text-xs text-on-surface-variant font-medium">
              Class: <span className="font-bold text-on-surface">{student.class.name}-{student.class.section}</span> • Roll #{student.rollNumber} • Guardian: {student.guardianName} ({student.guardianPhone})
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
          <button
            onClick={() => setNoteModalOpen(true)}
            className="px-3.5 py-2 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <span className="material-symbols-outlined text-[18px] text-secondary">edit_note</span>
            <span>Add Observation</span>
          </button>
          <Link
            href={`/print/attendance/${id}`}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-semibold"
          >
            <span className="material-symbols-outlined text-[18px]">print</span>
            Attendance report
          </Link>
          <Link
            href={`/print/report-card/${id}`}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-secondary text-on-secondary text-xs font-semibold hover:bg-secondary/90 shadow-sm"
          >
            <span className="material-symbols-outlined text-[18px]">print</span>
            Report card
          </Link>
        </div>
      </div>

      {/* KPI Overview Pills */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Attendance Rate */}
        <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              Attendance Standing
            </span>
            <div className="text-xl font-bold text-on-tertiary-container mt-0.5">
              {stats.attendance.percentage}%
            </div>
            <span className="text-[10px] text-on-surface-variant">
              {stats.attendance.present} Present / {stats.attendance.absent} Absent
            </span>
          </div>
          <div className="w-10 h-10 rounded-lg bg-tertiary-container/10 text-on-tertiary-container flex items-center justify-center">
            <span className="material-symbols-outlined text-[22px]">event_available</span>
          </div>
        </div>

        {/* Academic GPA / Percentage */}
        <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              Academic GPA
            </span>
            <div className="text-xl font-bold text-secondary mt-0.5">
              {stats.academics.gpa.toFixed(2)} / 4.00
            </div>
            <span className="text-[10px] text-on-surface-variant">
              Score: {stats.academics.percentage}% ({stats.academics.obtainedMarks}/{stats.academics.totalMarks})
            </span>
          </div>
          <div className="w-10 h-10 rounded-lg bg-secondary/10 text-secondary flex items-center justify-center">
            <span className="material-symbols-outlined text-[22px]">workspace_premium</span>
          </div>
        </div>

        {/* Fee Standing */}
        <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              Fee Balance
            </span>
            <div className="text-xl font-bold text-on-surface mt-0.5">
              {formatCurrency(stats.fees.outstanding)}
            </div>
            <span className="text-[10px] text-on-surface-variant">
              Paid: {formatCurrency(stats.fees.paid)} / Total: {formatCurrency(stats.fees.expected)}
            </span>
          </div>
          <div className="w-10 h-10 rounded-lg bg-surface-container text-primary flex items-center justify-center">
            <span className="material-symbols-outlined text-[22px]">payments</span>
          </div>
        </div>
      </div>

      {/* Dossier Navigation Tabs */}
      <div className="border-b border-surface-container-high/60 flex space-x-2 sm:space-x-4 overflow-x-auto no-print">
        {[
          { key: "overview", label: "Overview & Biodata", icon: "badge" },
          { key: "attendance", label: "Attendance History", icon: "calendar_today" },
          { key: "fees", label: "Fee Ledger & Challans", icon: "receipt_long" },
          { key: "exams", label: "Official Report Card", icon: "grade" },
          { key: "conduct", label: "Observations & Conduct", icon: "psychology" },
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

      {/* Tab 1: Overview */}
      {activeTab === "overview" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-4">
            <h3 className="font-headline-md text-sm font-bold text-on-surface border-b border-surface-container-low pb-2 flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary text-[18px]">person</span>
              Personal Information
            </h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-on-surface-variant">Full Name</span>
                <p className="font-semibold text-on-surface">{student.firstName} {student.lastName}</p>
              </div>
              <div>
                <span className="text-on-surface-variant">Gender</span>
                <p className="font-semibold text-on-surface capitalize">{student.gender}</p>
              </div>
              <div>
                <span className="text-on-surface-variant">Date of Birth</span>
                <p className="font-semibold text-on-surface">{formatDate(student.dob)}</p>
              </div>
              <div>
                <span className="text-on-surface-variant">Blood Group</span>
                <p className="font-semibold text-on-surface">{student.bloodGroup || "Not Specified"}</p>
              </div>
              <div>
                <span className="text-on-surface-variant">B-Form / CNIC</span>
                <p className="font-semibold text-on-surface font-mono">{student.cnicBForm || "Not Provided"}</p>
              </div>
              <div>
                <span className="text-on-surface-variant">Admission Date</span>
                <p className="font-semibold text-on-surface">{formatDate(student.admissionDate)}</p>
              </div>
              <div className="col-span-2">
                <span className="text-on-surface-variant">Residential Address</span>
                <p className="font-semibold text-on-surface">{student.address || "Not Provided"}</p>
              </div>
            </div>
          </div>

          <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-4">
            <h3 className="font-headline-md text-sm font-bold text-on-surface border-b border-surface-container-low pb-2 flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary text-[18px]">family_restroom</span>
              Guardian & Contact Details
            </h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-on-surface-variant">Guardian Name</span>
                <p className="font-semibold text-on-surface">{student.guardianName}</p>
              </div>
              <div>
                <span className="text-on-surface-variant">Relationship</span>
                <p className="font-semibold text-on-surface">{student.guardianRelation}</p>
              </div>
              <div>
                <span className="text-on-surface-variant">Primary Phone</span>
                <p className="font-semibold text-on-surface font-mono">{student.guardianPhone}</p>
              </div>
              <div>
                <span className="text-on-surface-variant">Guardian Email</span>
                <p className="font-semibold text-on-surface truncate">{student.guardianEmail || "N/A"}</p>
              </div>
              <div>
                <span className="text-on-surface-variant">Occupation</span>
                <p className="font-semibold text-on-surface">{student.guardianOccupation || "Self Employed"}</p>
              </div>
              <div>
                <span className="text-on-surface-variant">Portal User</span>
                <p className="font-semibold text-on-surface">{student.user?.username}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Attendance History */}
      {activeTab === "attendance" && (
        <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
          <div className="p-4 border-b border-surface-container-low flex items-center justify-between">
            <h3 className="font-headline-md text-sm font-bold text-on-surface">Daily Attendance Roster</h3>
            <span className="text-xs text-on-surface-variant">{student.attendances.length} days recorded</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-surface-container-low text-on-surface-variant uppercase text-[11px] font-bold">
                  <th className="py-2.5 px-4">Date</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Remarks / Explanation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container-low">
                {student.attendances.map((att: any) => (
                  <tr key={att.id} className="hover:bg-surface-container-low/40">
                    <td className="py-2.5 px-4 font-semibold text-on-surface">{formatDate(att.date)}</td>
                    <td className="py-2.5 px-4">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          att.status === "PRESENT"
                            ? "bg-tertiary-container/10 text-on-tertiary-container"
                            : att.status === "LATE"
                            ? "bg-amber-100 text-amber-800"
                            : att.status === "LEAVE"
                            ? "bg-secondary/10 text-secondary"
                            : "bg-error-container text-on-error-container"
                        }`}
                      >
                        {att.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-on-surface-variant">{att.remarks || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Fees & Challans */}
      {activeTab === "fees" && (
        <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
          <div className="p-4 border-b border-surface-container-low flex items-center justify-between">
            <h3 className="font-headline-md text-sm font-bold text-on-surface">Issued Fee Challans & Payments</h3>
            <span className="text-xs text-on-surface-variant font-semibold">
              Outstanding Balance: {formatCurrency(stats.fees.outstanding)}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-surface-container-low text-on-surface-variant uppercase text-[11px] font-bold">
                  <th className="py-2.5 px-4">Challan #</th>
                  <th className="py-2.5 px-4">Month/Period</th>
                  <th className="py-2.5 px-4">Due Date</th>
                  <th className="py-2.5 px-4">Expected</th>
                  <th className="py-2.5 px-4">Paid</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container-low">
                {student.feeChallans.map((ch: any) => (
                  <tr key={ch.id} className="hover:bg-surface-container-low/40">
                    <td className="py-2.5 px-4 font-mono font-semibold text-on-surface">{ch.challanNumber}</td>
                    <td className="py-2.5 px-4 font-medium">{ch.month} {ch.year}</td>
                    <td className="py-2.5 px-4 text-on-surface-variant">{formatDate(ch.dueDate)}</td>
                    <td className="py-2.5 px-4 font-semibold">{formatCurrency(ch.totalExpected)}</td>
                    <td className="py-2.5 px-4 font-bold text-on-tertiary-container">{formatCurrency(ch.paidAmount)}</td>
                    <td className="py-2.5 px-4">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          ch.status === "PAID"
                            ? "bg-tertiary-container/10 text-on-tertiary-container"
                            : ch.status === "PARTIAL"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-error-container text-on-error-container"
                        }`}
                      >
                        {ch.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap space-x-2">
                      <Link href={`/print/challan/${ch.id}`} className="text-secondary font-semibold">
                        Print
                      </Link>
                      {ch.status !== "PAID" && (
                        <button
                          onClick={() => {
                            setSelectedChallan(ch);
                            setPayAmount((ch.totalExpected - ch.paidAmount).toString());
                            setPaymentModalOpen(true);
                          }}
                          className="px-2.5 py-1 rounded bg-secondary text-on-secondary font-semibold text-[11px] hover:bg-secondary/90"
                        >
                          Collect Payment
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 4: Official Report Card */}
      {activeTab === "exams" && (
        <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 p-6 space-y-6">
          {/* Institutional Report Card Header */}
          <div className="border-b-2 border-primary/20 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary text-[24px]">school</span>
                <h2 className="font-headline-lg text-lg sm:text-xl font-bold text-on-surface uppercase tracking-tight">
                  Examination results
                </h2>
              </div>
              <p className="text-xs text-on-surface-variant font-medium mt-0.5">
                Recorded marks for this student. Print the report card for a printable copy.
              </p>
            </div>
            <Link
              href={`/print/report-card/${id}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-secondary text-on-secondary text-xs font-bold"
            >
              Print report card
            </Link>
          </div>

          {/* Subject-wise Marks Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs sm:text-sm">
              <thead>
                <tr className="bg-surface-container-low text-on-surface-variant uppercase text-[11px] font-bold">
                  <th className="py-3 px-4">Subject</th>
                  <th className="py-3 px-4">Code</th>
                  <th className="py-3 px-4">Max Marks</th>
                  <th className="py-3 px-4">Marks Obtained</th>
                  <th className="py-3 px-4">Percentage</th>
                  <th className="py-3 px-4">Grade</th>
                  <th className="py-3 px-4">GPA</th>
                  <th className="py-3 px-4">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container-low">
                {student.examResults.map((r: any) => {
                  const pct = Math.round((r.marksObtained / r.maxMarks) * 100);
                  return (
                    <tr key={r.id} className="hover:bg-surface-container-low/40">
                      <td className="py-3 px-4 font-bold text-on-surface">
                        {r.examSchedule?.subject?.name || "Subject"}
                      </td>
                      <td className="py-3 px-4 font-mono text-on-surface-variant">
                        {r.examSchedule?.subject?.code || "SUB"}
                      </td>
                      <td className="py-3 px-4">{r.maxMarks}</td>
                      <td className="py-3 px-4 font-bold text-on-surface">{r.marksObtained}</td>
                      <td className="py-3 px-4 font-semibold">{pct}%</td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded bg-surface-container font-bold text-secondary">
                          {r.grade}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-bold">{typeof r.gpa === "number" ? r.gpa.toFixed(1) : "—"}</td>
                      <td className="py-3 px-4 text-on-surface-variant text-xs">{r.remarks || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-surface-container font-bold text-xs border-t-2 border-primary/20">
                  <td className="py-3 px-4">Total Aggregate</td>
                  <td className="py-3 px-4">—</td>
                  <td className="py-3 px-4">{stats.academics.totalMarks}</td>
                  <td className="py-3 px-4 text-secondary">{stats.academics.obtainedMarks}</td>
                  <td className="py-3 px-4">{stats.academics.percentage}%</td>
                  <td className="py-3 px-4">—</td>
                  <td className="py-3 px-4">{typeof stats.academics.gpa === "number" ? stats.academics.gpa.toFixed(2) : "—"}</td>
                  <td className="py-3 px-4"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Tab 5: Behavioral Observations */}
      {activeTab === "conduct" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-headline-md text-sm font-bold text-on-surface">
              Faculty Observations & Behavioral Conduct Logs
            </h3>
            <button
              onClick={() => setNoteModalOpen(true)}
              className="px-3 py-1.5 rounded-lg bg-secondary text-on-secondary text-xs font-semibold flex items-center gap-1 hover:bg-secondary/90"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              <span>New Observation</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {student.observations.map((obs: any) => (
              <div
                key={obs.id}
                className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      obs.category === "ACADEMIC"
                        ? "bg-secondary/10 text-secondary"
                        : obs.category === "LEADERSHIP"
                        ? "bg-purple-100 text-purple-800"
                        : "bg-tertiary-container/10 text-on-tertiary-container"
                    }`}
                  >
                    {obs.category}
                  </span>
                  <span className="text-[10px] text-on-surface-variant">{formatDate(obs.date)}</span>
                </div>
                <h4 className="font-bold text-xs text-on-surface">{obs.title}</h4>
                <p className="text-xs text-on-surface-variant leading-relaxed">{obs.content}</p>
                <div className="pt-2 border-t border-surface-container-low text-[10px] text-on-surface-variant flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px] text-secondary">verified</span>
                  <span>Recorded by {obs.teacher?.firstName} {obs.teacher?.lastName}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 6: Attached Documents & Files */}
      {activeTab === "documents" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-headline-md text-sm font-bold text-on-surface">
                Student Documents & Verified Records
              </h3>
              <p className="text-xs text-on-surface-variant font-medium mt-0.5">
                Manage official copies of ID cards, certificates, and admission files stored in Firebase Storage.
              </p>
            </div>
            <button
              onClick={() => setDocModalOpen(true)}
              className="px-3.5 py-2 rounded-lg bg-secondary text-on-secondary text-xs font-semibold flex items-center gap-1.5 hover:bg-secondary/90 shadow-sm"
            >
              <span className="material-symbols-outlined text-[18px]">upload_file</span>
              <span>Attach Document</span>
            </button>
          </div>

          {/* Photo Management Card */}
          <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40">
            <h4 className="font-bold text-xs text-on-surface mb-3 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[18px] text-secondary">account_box</span>
              <span>Official Student Photograph</span>
            </h4>
            <FileUpload
              folder="profile-photos"
              label=""
              helperText="Upload official passport-size portrait (JPG, PNG, WebP up to 5MB)"
              currentUrl={student.photoUrl}
              onUploadComplete={handleUpdatePhoto}
              onRemove={() => handleUpdatePhoto("")}
              previewType="image"
            />
            {photoSaving && <p className="text-[11px] text-secondary mt-1">Updating student photograph...</p>}
          </div>

          {/* Documents Grid */}
          {(!student.documents || student.documents.length === 0) ? (
            <div className="p-8 rounded-xl bg-surface-container-lowest border border-dashed border-outline-variant text-center space-y-2">
              <span className="material-symbols-outlined text-4xl text-on-surface-variant">inventory_2</span>
              <p className="text-xs font-semibold text-on-surface">No documents attached yet</p>
              <p className="text-[11px] text-on-surface-variant max-w-sm mx-auto">
                Attach identity documentation, prior school leaving certificates, or birth registration documents.
              </p>
              <button
                onClick={() => setDocModalOpen(true)}
                className="mt-2 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-secondary/10 text-secondary text-xs font-semibold hover:bg-secondary/20"
              >
                <span className="material-symbols-outlined text-[16px]">add</span>
                <span>Attach First Document</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {student.documents.map((doc: any) => (
                <div
                  key={doc.id}
                  className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-col justify-between space-y-3"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-surface-container flex items-center justify-center shrink-0 text-secondary">
                      <span className="material-symbols-outlined text-[22px]">
                        {doc.url?.includes(".pdf") ? "picture_as_pdf" : "description"}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-secondary/10 text-secondary">
                          {doc.type.replace(/_/g, " ")}
                        </span>
                      </div>
                      <h5 className="font-semibold text-xs text-on-surface truncate mt-1" title={doc.name}>
                        {doc.name}
                      </h5>
                      <p className="text-[10px] text-on-surface-variant mt-0.5">
                        Uploaded {formatDate(doc.uploadedAt)}
                      </p>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-surface-container-low flex items-center justify-between">
                    <a
                      href={doc.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-secondary hover:underline"
                    >
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
      )}

      {/* Document Upload Modal */}
      {docModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="attach-document-heading"
            className="bg-surface-container-lowest rounded-xl max-w-md w-full p-5 shadow-2xl border border-surface-container-high space-y-4 my-8"
          >
            <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
              <h3 id="attach-document-heading" className="font-headline-md text-sm font-bold text-on-surface">
                Attach Student Document
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
                  <option value="ID_CARD">B-Form / ID Card Scan</option>
                  <option value="CERTIFICATE">Birth / Leaving Certificate</option>
                  <option value="ADMISSION_FORM">Admission Application Form</option>
                  <option value="OTHER">Other Educational Record</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-on-surface mb-1">Document Title / Label *</label>
                <input
                  type="text"
                  required
                  value={docName}
                  onChange={(e) => setDocName(e.target.value)}
                  placeholder="e.g. NADRA B-Form Verified Copy"
                  className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20"
                />
              </div>

              <FileUpload
                folder="documents"
                label="Select File to Upload *"
                helperText="Upload PDF or scanned image (up to 10MB)"
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
                  {docSaving ? "Saving..." : "Attach Document"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Payment Recording Modal */}
      {paymentModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="student-fee-collection-heading"
            className="bg-surface-container-lowest rounded-xl max-w-md w-full p-5 shadow-2xl border border-surface-container-high space-y-4 max-h-[90vh] overflow-y-auto my-8"
          >
            <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
              <h3 id="student-fee-collection-heading" className="font-headline-md text-sm font-bold text-on-surface">Record Fee Collection</h3>
              <button
                onClick={() => setPaymentModalOpen(false)}
                className="text-on-surface-variant hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <form onSubmit={handleRecordPayment} className="space-y-3 text-xs">
              <div>
                <label htmlFor="id-challan-reference-1" className="block font-semibold text-on-surface mb-1">Challan Reference</label>
                <input id="id-challan-reference-1"
                  type="text"
                  disabled
                  value={selectedChallan?.challanNumber}
                  className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface font-mono"
                />
              </div>

              <div>
                <label htmlFor="id-amount-to-pay-pkr-2" className="block font-semibold text-on-surface mb-1">Amount to Pay (PKR)</label>
                <input id="id-amount-to-pay-pkr-2"
                  type="number"
                  required
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40 font-semibold"
                />
              </div>

              <div>
                <label htmlFor="id-payment-method-3" className="block font-semibold text-on-surface mb-1">Payment Method</label>
                <select id="id-payment-method-3"
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value)}
                  className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                >
                  <option value="Bank Deposit">Bank Deposit / ABL Challan</option>
                  <option value="Cash Desk">Cash Collection Counter</option>
                  <option value="Online Transfer">Online / Raast Transfer</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPaymentModalOpen(false)}
                  className="px-3 py-1.5 rounded bg-surface-container text-on-surface font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={payLoading}
                  className="px-4 py-1.5 rounded bg-secondary text-on-secondary font-semibold hover:bg-secondary/90 disabled:opacity-50"
                >
                  {payLoading ? "Processing..." : "Confirm & Save Receipt"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Observation Modal */}
      {noteModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-observation-heading"
            className="bg-surface-container-lowest rounded-xl max-w-md w-full p-5 shadow-2xl border border-surface-container-high space-y-4 max-h-[90vh] overflow-y-auto my-8"
          >
            <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
              <h3 id="add-observation-heading" className="font-headline-md text-sm font-bold text-on-surface">Add Behavioral Observation</h3>
              <button
                onClick={() => setNoteModalOpen(false)}
                className="text-on-surface-variant hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <form onSubmit={handleAddObservation} className="space-y-3 text-xs">
              <div>
                <label htmlFor="id-observation-title-4" className="block font-semibold text-on-surface mb-1">Observation Title</label>
                <input id="id-observation-title-4"
                  type="text"
                  required
                  placeholder="e.g. Outstanding Science Project"
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                  className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                />
              </div>

              <div>
                <label htmlFor="id-category-5" className="block font-semibold text-on-surface mb-1">Category</label>
                <select id="id-category-5"
                  value={noteCategory}
                  onChange={(e) => setNoteCategory(e.target.value)}
                  className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                >
                  <option value="ACADEMIC">Academic Excellence</option>
                  <option value="LEADERSHIP">Leadership & Citizenship</option>
                  <option value="CONDUCT">Behavior & Conduct</option>
                  <option value="PARTICIPATION">Classroom Participation</option>
                </select>
              </div>

              <div>
                <label htmlFor="id-details-remarks-6" className="block font-semibold text-on-surface mb-1">Details & Remarks</label>
                <textarea id="id-details-remarks-6"
                  required
                  rows={3}
                  placeholder="Provide detailed comments on student conduct or achievements..."
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  className="w-full p-2 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setNoteModalOpen(false)}
                  className="px-3 py-1.5 rounded bg-surface-container text-on-surface font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={noteLoading}
                  className="px-4 py-1.5 rounded bg-secondary text-on-secondary font-semibold hover:bg-secondary/90 disabled:opacity-50"
                >
                  {noteLoading ? "Saving..." : "Save Observation"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
