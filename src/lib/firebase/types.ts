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
  parentUserIds?: string[];
  bloodGroup?: string;
  cnic?: string;
  bForm?: string;
  monthlyFee: number;
  discount: number;
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
  joiningDate?: string;
  status: "ACTIVE" | "INACTIVE";
  assignedClassIds: string[];
  assignedSubjectIds: string[];
  weeklyLoad: number;
  salary?: number;
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
  classTeacherId?: string;
  classTeacherName?: string;
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
  teacherId?: string;
  teacherName?: string;
  credits: number;
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
  createdAt?: string;
  updatedAt?: string;
}

export type AttendanceStatus = "PRESENT" | "LATE" | "ABSENT" | "LEAVE";

export interface AttendanceDoc {
  id: string; // schoolId_classId_studentId_date
  schoolId: string;
  classId: string;
  studentId: string;
  studentName?: string;
  rollNo?: string;
  date: string; // YYYY-MM-DD
  status: AttendanceStatus;
  remarks?: string;
  recordedBy: string;
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
  createdAt: string;
  updatedAt: string;
  // Automatic monthly generation (Phase 3) — optional so existing manually-created challans remain valid.
  academicYear?: string;
  previousOutstandingDues?: number;
  annualFeeCharged?: number;
  oneTimeChargesApplied?: boolean;
  source?: "MANUAL" | "AUTO_MONTHLY";
  yearlyStructureId?: string;
  generationBatchId?: string;
}

export type VoucherRowAction = "CREATED" | "SKIPPED_EXISTS" | "ERROR";

export interface VoucherGenerationRowResult {
  studentId: string;
  admissionNo: string;
  studentName: string;
  classId?: string;
  className?: string;
  action: VoucherRowAction;
  errorReason?: string;
  challanId?: string;
  totalExpected?: number;
}

export interface VoucherGenerationBatchDoc {
  id: string;
  schoolId: string;
  academicYear: string;
  month: string;
  year: number;
  scope: "SCHOOL" | "CLASS" | "STUDENT";
  classId?: string;
  studentId?: string;
  totalRows: number;
  createdCount: number;
  skippedCount: number;
  errorCount: number;
  rows: VoucherGenerationRowResult[];
  generatedBy: string;
  generatedByEmail: string;
  createdAt: string;
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
  notes?: string;
  collectedBy: string;
  createdAt: string;
  // Daily transaction import (Phase 4) — optional so existing counter-collection payments remain valid.
  source?: "MANUAL" | "IMPORT" | "REVERSAL";
  importBatchId?: string;
  // Links every PaymentDoc produced by allocating ONE imported row (which may span several
  // challans) back to that single source row, so the row's total is always reconcilable.
  allocationGroupId?: string;
  dedupKey?: string;
  // Reversal (Phase 5) — correcting a wrongly applied payment never deletes the original;
  // it adds a negative-amount PaymentDoc that references it instead.
  reversesPaymentId?: string;
  reversed?: boolean;
}

export interface AdvanceBalanceLedgerEntry {
  type: "CREDIT" | "DEBIT";
  amount: number;
  reason: string;
  refId: string;
  date: string;
}

export interface AdvanceBalanceDoc {
  id: string; // `${schoolId}__${academicYear}__${studentId}`
  schoolId: string;
  studentId: string;
  academicYear: string;
  balance: number;
  ledger: AdvanceBalanceLedgerEntry[];
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
  remarks?: string;
  evaluatedBy: string;
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
  category: "ACADEMIC" | "BEHAVIORAL" | "LEADERSHIP" | "ATTENDANCE" | "SPORTS";
  note: string;
  sentiment: "POSITIVE" | "NEUTRAL" | "NEEDS_IMPROVEMENT";
  createdAt: string;
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
  principalName: string;
  academicYear: string;
  taxRegistration?: string;
  gradingScale: {
    minPercentage: number;
    grade: string;
    gpa: number;
  }[];
  updatedAt: string;
}

export interface YearlyFeeStructureDoc {
  id: string; // `${schoolId}__${academicYear}__${admissionNo}` (deterministic -> idempotent upserts)
  schoolId: string;
  academicYear: string;
  studentId: string;
  admissionNo: string;
  studentName: string;
  classId: string;
  className?: string;
  section?: string;
  monthlyTuitionFee: number;
  annualFee: number;
  admissionFee: number;
  otherCharges: number;
  discount: number;
  notes?: string;
  source: "IMPORT" | "MANUAL";
  importBatchId?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export type ImportBatchType = "YEARLY_FEE_STRUCTURE" | "DAILY_TRANSACTIONS";

export type ImportRowAction =
  | "CREATED"
  | "UPDATED"
  | "UNCHANGED"
  | "ALLOCATED"
  | "DUPLICATE_IN_FILE"
  | "DUPLICATE_EXISTS"
  | "ERROR";

export interface ImportBatchRowResult {
  rowNumber: number;
  admissionNo: string;
  studentName?: string;
  action: ImportRowAction;
  errorReason?: string;
  previousValues?: Record<string, number>;
  newValues?: Record<string, number>;
  details?: Record<string, any>;
}

export interface ImportBatchDoc {
  id: string;
  schoolId: string;
  type: ImportBatchType;
  academicYear: string;
  fileName: string;
  totalRows: number;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  errorCount: number;
  rows: ImportBatchRowResult[];
  uploadedBy: string;
  uploadedByEmail: string;
  createdAt: string;
}

export type OtherCollectionCategory = "REGISTRATION" | "CERTIFICATE" | "FINE" | "EVENT" | "OTHER";

export interface OtherCollectionDoc {
  id: string;
  schoolId: string;
  date: string;
  category: OtherCollectionCategory;
  description: string;
  amount: number;
  paymentMethod?: "CASH" | "BANK_TRANSFER" | "ONLINE" | "CHEQUE";
  reference?: string;
  createdBy: string;
  createdByEmail: string;
  createdAt: string;
  updatedAt: string;
  reversed?: boolean;
  reversedReason?: string;
  reversedBy?: string;
  reversedAt?: string;
}

export type OtherExpenseCategory = "ELECTRICITY" | "MAINTENANCE" | "STATIONERY" | "STAFF" | "TRANSPORT" | "OTHER";

export interface OtherExpenseDoc {
  id: string;
  schoolId: string;
  date: string;
  category: OtherExpenseCategory;
  description: string;
  amount: number;
  paymentMethod?: "CASH" | "BANK_TRANSFER" | "ONLINE" | "CHEQUE";
  reference?: string;
  createdBy: string;
  createdByEmail: string;
  createdAt: string;
  updatedAt: string;
  reversed?: boolean;
  reversedReason?: string;
  reversedBy?: string;
  reversedAt?: string;
}

export type FeeAdjustmentType =
  | "MONTHLY_FEE_CHANGE"
  | "ANNUAL_FEE_CHANGE"
  | "ADMISSION_FEE_CHANGE"
  | "OTHER_CHARGES_CHANGE"
  | "DISCOUNT_CHANGE"
  | "ADDITIONAL_CHARGE"
  | "CONCESSION"
  | "PREVIOUS_BALANCE_CORRECTION"
  | "PAYMENT_REVERSAL";

export interface FeeAdjustmentDoc {
  id: string;
  schoolId: string;
  studentId: string;
  admissionNo: string;
  studentName: string;
  academicYear: string;
  effectiveDate: string;
  adjustmentType: FeeAdjustmentType;
  // For structure-level changes (fee amounts): previousValue/newValue are the full field values.
  // For voucher-level one-off adjustments: previousValue/newValue are the voucher's totalExpected
  // before/after, and challanId identifies which voucher.
  previousValue: number;
  newValue: number;
  challanId?: string;
  reason: string;
  adminUserId: string;
  adminEmail: string;
  createdAt: string;
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
