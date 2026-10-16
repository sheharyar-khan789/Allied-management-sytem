export type UserRole = "ADMIN" | "TEACHER" | "STUDENT" | "PARENT";
export type UserStatus = "ACTIVE" | "INACTIVE" | "SUSPENDED";

export interface School {
  id: string;
  name: string;
  code: string;
  address?: string;
  phone?: string;
  email?: string;
  principalName?: string;
  logoUrl?: string;
  academicYear: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  schoolId: string;
  status: UserStatus;
  passwordHash?: string;
  /** Legacy single-token fields from the previous reset flow; cleared on every successful reset. */
  resetTokenHash?: string;
  resetTokenExpires?: string;
  /**
   * ISO timestamp. Sessions whose original sign-in (`authAt`) is earlier than this are rejected
   * server-side — set on password reset/change so other signed-in sessions stop working.
   */
  sessionsValidAfter?: string;
  /** Session ids (`sid` claim) revoked by logout; only the most recent few are kept. */
  revokedSessionIds?: string[];
  /** TOTP two-factor for ADMIN accounts (enforced only when ADMIN_MFA_ENABLED=true). Server-side only. */
  mfaEnabled?: boolean;
  mfaSecret?: string;
  mfaPendingSecret?: string;
  mfaLastUsedStep?: number;
  teacherId?: string;
  studentId?: string;
  studentIds?: string[];
  photoUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StudentDoc {
  id: string;
  schoolId: string;
  userId?: string;
  admissionNo: string;
  fullName: string;
  fatherName: string;
  gender: "MALE" | "FEMALE";
  dob?: string;
  /** Admission / enrollment date (YYYY-MM-DD). Legacy records fall back to createdAt. */
  admissionDate?: string;
  phone?: string;
  address?: string;
  classId: string;
  className?: string;
  section: string;
  rollNo: string;
  status: "ACTIVE" | "INACTIVE" | "ALUMNI" | "EXPELLED";
  guardianName: string;
  guardianPhone: string;
  guardianRelation: string;
  guardianEmail?: string;
  email?: string;
  parentUserIds?: string[];
  bloodGroup?: string;
  cnic?: string;
  bForm?: string;
  monthlyFee: number;
  /** Annual fee (PKR), configured independently of monthlyFee — never derived as 12 × monthly. */
  annualFee?: number;
  discount: number;
  photoUrl?: string;
  /** Academic session (YYYY-YYYY) this record belongs to. Legacy records without it are
   *  attributed to their class/exam session — see src/lib/academic-session.ts. */
  academicYear?: string;
  documents?: {
    id: string;
    name: string;
    type: "ID_CARD" | "CERTIFICATE" | "ADMISSION_FORM" | "OTHER";
    url: string;
    uploadedAt: string;
    size?: number;
  }[];
  createdAt: string;
  updatedAt: string;
}

export interface TeacherDoc {
  id: string;
  schoolId: string;
  userId?: string;
  employeeId: string;
  fullName: string;
  email: string;
  phone: string;
  designation: string;
  department: string;
  qualification: string;
  photoUrl?: string;
  joiningDate?: string;
  endingDate?: string | null;
  status: "ACTIVE" | "INACTIVE";
  assignedClassIds: string[];
  assignedSubjectIds: string[];
  weeklyLoad: number;
  salary?: number;
  baseSalary?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ClassDoc {
  id: string;
  schoolId: string;
  name: string;
  section: string;
  numericLevel: number;
  capacity: number;
  roomNo?: string;
  classTeacherId?: string | null;
  classTeacherName?: string | null;
  academicYear: string;
  createdAt: string;
  updatedAt: string;
}

export interface SubjectDoc {
  id: string;
  schoolId: string;
  classId: string;
  className?: string;
  name: string;
  code: string;
  teacherId?: string | null;
  teacherName?: string | null;
  credits: number;
  academicYear?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TimetableDoc {
  id: string; // schoolId_teacherId_day_period or uuid
  schoolId: string;
  teacherId: string;
  teacherName?: string;
  classId: string;
  className: string;
  subjectId?: string;
  subjectName: string;
  dayOfWeek: "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday";
  periodName: string; // e.g. "Period 1"
  startTime: string; // e.g. "08:00 AM"
  endTime: string; // e.g. "08:45 AM"
  roomNo?: string;
  topic?: string;
  academicYear?: string;
  /** Set on periods created by a timetable import (see TimetableImportDoc). */
  importId?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * One timetable import. STRUCTURED: periods were created from a file (CSV/XLSX, or an image/PDF
 * read automatically and confirmed by an admin); they carry `importId`. IMAGE: the file itself is
 * the timetable (stored in Firebase Storage and displayed as-is; no editable periods).
 */
export interface TimetableImportDoc {
  id: string;
  schoolId: string;
  kind: "STRUCTURED" | "IMAGE";
  title: string;
  source: "csv" | "xlsx" | "image" | "pdf";
  fileName?: string;
  /** Original file (image/PDF), if stored. */
  fileUrl?: string;
  storagePath?: string;
  contentType?: string;
  /** Date printed on the timetable, as written (optional). */
  printedDate?: string;
  slotCount: number;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
}

export type AttendanceStatus = "PRESENT" | "LATE" | "ABSENT" | "LEAVE";

export interface AttendanceDoc {
  id: string; // schoolId_classId_studentId_date (daily) or schoolId_classId_subjectId_studentId_date
  schoolId: string;
  classId: string;
  /**
   * Set only on a subject register (marked by that subject's allocated teacher). Records
   * without it form the class's daily register, which is the one student/parent/report
   * attendance figures are computed from.
   */
  subjectId?: string;
  subjectName?: string;
  studentId: string;
  studentName?: string;
  rollNo?: string;
  date: string; // YYYY-MM-DD
  status: AttendanceStatus;
  remarks?: string;
  recordedBy: string;
  /** uid of the last user who changed an existing record (admin overrides included). */
  updatedBy?: string;
  academicYear?: string;
  createdAt: string;
  updatedAt: string;
}

export type FeeStatus = "PAID" | "PENDING" | "OVERDUE" | "PARTIAL";

export interface FeeChallanDoc {
  id: string;
  schoolId: string;
  studentId: string;
  studentName?: string;
  admissionNo?: string;
  classId: string;
  className?: string;
  challanNo: string;
  month: string;
  year: number;
  issueDate: string;
  dueDate: string;
  tuitionFee: number;
  admissionFee: number;
  examFee: number;
  otherFee: number;
  discount: number;
  totalExpected: number;
  paidAmount: number;
  balanceAmount: number;
  status: FeeStatus;
  receiptUrl?: string;
  academicYear?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentDoc {
  id: string;
  schoolId: string;
  challanId: string;
  studentId: string;
  studentName?: string;
  receiptNo: string;
  amount: number;
  paymentDate: string;
  paymentMode: "CASH" | "BANK_TRANSFER" | "ONLINE" | "CHEQUE";
  transactionRef?: string;
  receiptUrl?: string;
  notes?: string;
  collectedBy: string;
  academicYear?: string;
  createdAt: string;
}

export const FEE_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;
export type FeeMonth = (typeof FEE_MONTHS)[number];

export interface FeeMonthStatus {
  paid: boolean;
  paidAt?: string | null;
  updatedBy?: string;
  updatedAt?: string;
}

/**
 * One student's fee-status ledger for one calendar year (collection `studentFeeLedgers`).
 * Each of the 12 months persists independently; the annual fee's paid state is tracked here too.
 */
export interface StudentFeeLedgerDoc {
  id: string; // `${schoolId}_${studentId}_${year}`
  schoolId: string;
  studentId: string;
  studentName?: string;
  year: number;
  months: Partial<Record<FeeMonth, FeeMonthStatus>>;
  annualFeePaid?: boolean;
  annualFeePaidAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export const STUDENT_CHARGE_TYPES = ["EVENT", "TRIP", "SPORTS", "EXAM", "ACTIVITY", "OTHER"] as const;
export type StudentChargeType = (typeof STUDENT_CHARGE_TYPES)[number];

/** An additional / event payment owed by a student (collection `studentCharges`). */
export interface StudentChargeDoc {
  id: string;
  schoolId: string;
  studentId: string;
  studentName?: string;
  type: StudentChargeType;
  description: string;
  amount: number;
  date: string; // YYYY-MM-DD
  status: "PAID" | "UNPAID";
  notes?: string;
  createdBy: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExamDoc {
  id: string;
  schoolId: string;
  name: string;
  term: string;
  session: string;
  startDate: string;
  endDate: string;
  status: "UPCOMING" | "ONGOING" | "COMPLETED" | "PUBLISHED";
  resultSheetUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExamScheduleDoc {
  id: string;
  schoolId: string;
  examId: string;
  classId: string;
  subjectId: string;
  subjectName?: string;
  examDate: string;
  startTime: string;
  endTime: string;
  totalMarks: number;
  passingMarks: number;
  roomNo?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface ExamResultDoc {
  id: string; // schoolId_examId_studentId_subjectId
  schoolId: string;
  examId: string;
  studentId: string;
  studentName?: string;
  rollNo?: string;
  classId: string;
  subjectId: string;
  subjectName?: string;
  scheduleId?: string;
  obtainedMarks: number;
  totalMarks: number;
  percentage: number;
  grade: string;
  gpa: number;
  status: "PASS" | "FAIL";
  cardUrl?: string;
  remarks?: string;
  evaluatedBy: string;
  academicYear?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StudentObservationDoc {
  id: string;
  schoolId: string;
  studentId: string;
  studentName?: string;
  teacherId: string;
  teacherName?: string;
  category: "ACADEMIC" | "CONDUCT" | "BEHAVIORAL" | "LEADERSHIP" | "PARTICIPATION" | "ATTENDANCE" | "SPORTS";
  /** Short heading. Records saved before this field existed have the title merged into `note`. */
  title?: string;
  /** The written observation text. */
  note: string;
  /** Conduct rating. */
  sentiment: "POSITIVE" | "NEUTRAL" | "NEEDS_IMPROVEMENT";
  /** Class of the student when the observation was written. */
  classId?: string;
  /** Exam this observation is for (shown on that exam's report card); absent = general. */
  examId?: string;
  academicYear?: string;
  createdAt: string;
  updatedAt?: string;
  updatedBy?: string;
}

/**
 * ASD Weekly & Daily Lesson Plan (see src/lib/lesson-plan-schedule.ts for the Saturday
 * submission-window/lock rules this record is governed by).
 *
 * One document per teacher + class + subject + school week (`weekId`, the Monday the week
 * starts). The document id is deterministic (`lessonPlanDocId` in lesson-plan-schedule.ts) so a
 * second create for the same key upserts the same record instead of creating a duplicate.
 *
 * Mirrors the supplied "ASD Daily Lesson Plan" template: a Class/Subject/Teacher header plus one
 * free-text cell per calendar date. The template's month-long grid is this collection's records
 * for that teacher/class/subject regrouped by week; `days` holds one entry per teaching day
 * (Monday-Saturday) of this record's week.
 */
export interface LessonPlanDayEntry {
  /** YYYY-MM-DD, within [weekStartDate, weekEndDate]. */
  date: string;
  dayOfWeek: "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday";
  /** The lesson content for that date — the template's blank cell. */
  content: string;
  /** Teacher-marked: no class held this date (holiday, assessment day, etc.). */
  isNonTeachingDay?: boolean;
}

export interface LessonPlanAdminCorrection {
  at: string;
  by: string;
  byName?: string;
  reason: string;
  /** The `days` content as it was immediately before this correction, so nothing is silently lost. */
  previousDays: LessonPlanDayEntry[];
}

export interface LessonPlanDoc {
  /** `lessonPlanDocId(schoolId, teacherId, classId, subjectId, weekId)` — deterministic, see above. */
  id: string;
  schoolId: string;
  academicYear: string;
  teacherId: string;
  teacherName?: string;
  classId: string;
  className?: string;
  subjectId: string;
  subjectName?: string;
  /** Monday of this record's school week, YYYY-MM-DD. Also this record's natural sort key. */
  weekId: string;
  weekStartDate: string;
  /** Sunday of this record's school week, YYYY-MM-DD. */
  weekEndDate: string;
  days: LessonPlanDayEntry[];
  /**
   * Whether the teacher has finalized this record. Whether it is still editable (and the
   * teacher-facing status of DRAFT/SUBMITTED/LATE/LOCKED) is derived at read time from this flag
   * plus `submissionDeadline` — see lessonPlanStatus() in lesson-plan-schedule.ts — not stored,
   * so a change to the school's timezone setting never retroactively rewrites past records.
   */
  submitted: boolean;
  submittedAt?: string | null;
  /**
   * The Saturday-window close time (ISO) in effect when this record was first created, i.e. the
   * instant it becomes locked to the teacher. Stamped once and kept, so it survives later
   * timezone-setting changes.
   */
  submissionDeadline: string;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
  /** Soft delete: the record is kept (audit trail) but excluded from normal reads. */
  deletedAt?: string | null;
  deletedBy?: string;
  /** Admin corrections made after the teacher lock, oldest first. Never erases prior content. */
  adminCorrections?: LessonPlanAdminCorrection[];
}

export interface LockedRecordDoc {
  id: string;
  schoolId: string;
  studentId: string;
  studentName?: string;
  admissionNo?: string;
  type: "TRANSCRIPT" | "CERTIFICATE" | "TRANSFER_CERTIFICATE";
  academicYear: string;
  gpa?: number;
  percentage?: number;
  remarks?: string;
  sealedAt: string;
  sealedBy: string;
}

export interface AuditLogDoc {
  id: string;
  schoolId: string;
  userId: string;
  userEmail: string;
  role: string;
  action: string;
  entity: string;
  entityId?: string;
  details: string;
  timestamp: string;
}

export interface SchoolSettingsDoc {
  id: string;
  schoolId: string;
  schoolName: string;
  campusName: string;
  motto: string;
  address: string;
  phone: string;
  email: string;
  website?: string;
  logoUrl?: string;
  principalName: string;
  /** Designation printed under the head's name on report cards, e.g. "Principal". */
  principalTitle?: string;
  academicYear: string;
  taxRegistration?: string;
  currencySymbol?: string;
  gradingSystemLabel?: string;
  gradingScale: {
    minPercentage: number;
    grade: string;
    gpa: number;
  }[];
  /**
   * IANA timezone (e.g. "Asia/Karachi") the school's clock-based rules run on — currently the
   * weekly lesson-plan Saturday submission window/lock (see lesson-plan-schedule.ts). Explicitly
   * configured rather than inferred from the server, so a deployment in another region never
   * silently shifts the deadline. Defaults to Asia/Karachi (see DEFAULT_SCHOOL_TIMEZONE) when unset.
   */
  timezone?: string;
  updatedAt: string;
}

export type AnnouncementAudience = "EVERYONE" | "TEACHERS" | "STUDENTS" | "PARENTS";
export type AnnouncementStatus = "DRAFT" | "PUBLISHED";

export interface AnnouncementDoc {
  id: string;
  schoolId: string;
  title: string;
  message: string;
  audience: AnnouncementAudience;
  status: AnnouncementStatus;
  publishedAt?: string;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
}

export type PayrollStatus = "PAID" | "UNPAID";

export interface PayrollRecordDoc {
  id: string; // schoolId_teacherId_year_month or payrec-uuid
  schoolId: string;
  teacherId: string;
  teacherName?: string;
  employeeId?: string;
  month: string; // e.g., "September" or "09"
  year: number; // e.g., 2026
  amount: number;
  status: PayrollStatus;
  paidDate?: string; // YYYY-MM-DD
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Password reset token. The document id is the SHA-256 hash of the raw token, so the raw token
 * (which only ever exists in the emailed link) is never stored. Server-only collection: no
 * client Firestore rule grants access to it.
 */
export interface PasswordResetTokenDoc {
  id: string; // sha256(token)
  /** ACTIVATION: first-time password setup for an admin-created account. Absent = RESET. */
  purpose?: "RESET" | "ACTIVATION";
  uid: string;
  email: string;
  schoolId: string;
  expiresAt: string;
  usedAt?: string | null;
  createdAt: string;
}
