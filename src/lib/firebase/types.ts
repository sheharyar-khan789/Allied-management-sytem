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
  resetTokenHash?: string;
  resetTokenExpires?: string;
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
  email?: string;
  parentUserIds?: string[];
  bloodGroup?: string;
  cnic?: string;
  bForm?: string;
  monthlyFee: number;
  discount: number;
  photoUrl?: string;
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
  receiptUrl?: string;
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
  createdAt: string;
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
  logoUrl?: string;
  principalName: string;
  academicYear: string;
  taxRegistration?: string;
  currencySymbol?: string;
  gradingSystemLabel?: string;
  gradingScale: {
    minPercentage: number;
    grade: string;
    gpa: number;
  }[];
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
