# Allied School Management System — Real Firebase Production Build

A modern, full-stack, enterprise-grade School Management SaaS platform engineered with **Next.js 15 App Router**, **TypeScript**, **Tailwind CSS**, and **Firebase (Auth, Cloud Firestore, Security Rules, App Check)**. Preserves 1:1 visual fidelity with the approved design system, typography (`Plus Jakarta Sans` & `Inter`), Material Symbols icons, and institutional workflows.

---

## 🚀 Quick Start

### 1. Installation
```bash
# Clone or navigate to the repository
cd allied_school_management

# Install dependencies
npm install
```

### 2. Environment Configuration
Create or update `.env` in the root directory:

```env
# Client Firebase Configuration
NEXT_PUBLIC_FIREBASE_API_KEY="your-api-key"
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="allied-school-system.firebaseapp.com"
NEXT_PUBLIC_FIREBASE_PROJECT_ID="allied-school-system"
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET="allied-school-system.appspot.com"
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID="102938475612"
NEXT_PUBLIC_FIREBASE_APP_ID="1:102938475612:web:a1b2c3d4e5f6g7h8"
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID="G-ALLIEDSCH01"

# App Check (Optional)
NEXT_PUBLIC_FIREBASE_APP_CHECK_KEY="your-recaptcha-v3-site-key"

# Server Firebase Admin Configuration (Optional for cloud server endpoints)
FIREBASE_PROJECT_ID="allied-school-system"
FIREBASE_CLIENT_EMAIL="firebase-adminsdk@allied-school-system.iam.gserviceaccount.com"
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

### 3. Run Development / Production Server
```bash
# Development mode
npm run dev

# Production build and launch
npm run build
npm start -- -p 3002
```

Navigate to **[http://localhost:3002](http://localhost:3002)**.

---

## 🔑 Demo Access Credentials

The application features Role-Based Access Control (RBAC) with pre-configured accounts:

| Portal Role | Email | Password | Scope & Redirect |
|---|---|---|---|
| 🏢 **Admin / Principal** | `admin@alliedschool.edu` | `AdminSecure2025#` | Full School Administration (`/admin`) |
| 👩‍🏫 **Teacher / Staff** | `teacher@alliedschool.edu` | `TeacherSecure2025#` | Timetable, Roll Call & Rapid Gradebook (`/teacher`) |
| 🎓 **Student / Parent** | `student@alliedschool.edu` | `StudentSecure2025#` | Biodata, Attendance, Fees & Report Card (`/student`) |

> [!TIP]
> The sign-in screen at `/login` provides:
> 1. One-click **Role Selector Tabs** and **Auto Fill** demo helper.
> 2. **Register School (Admin Only)** tab to provision a new school institution and administrator account.
> 3. **Forgot Password** modal for dispatching password reset links via Firebase Auth.

---

## 🛠️ Architecture & Tech Stack

- **Framework**: Next.js 15 (App Router, Server Components, Route Handlers)
- **Language**: TypeScript (Strict Mode)
- **Backend & Database**: Firebase Authentication, Cloud Firestore, Firebase Storage
- **Security**: Production `firestore.rules` enforcing multi-tenant school isolation and role permissions
- **Query Optimization**: Pre-configured composite indexes in `firestore.indexes.json`
- **Styling**: Tailwind CSS v3 with custom brand tokens and print stylesheets
- **Typography & Icons**: Plus Jakarta Sans, Inter, Google Material Symbols Outlined

---

## 🛡️ Firestore Security Rules (`firestore.rules`)

The system enforces strict security boundaries:
1. **School Isolation**: `getUserSchoolId() == resource.data.schoolId`. Users can only access documents belonging to their school.
2. **Student Privacy**: Students can access only their own profile, attendance, fee challans, and results.
3. **Teacher Permissions**: Teachers can access only authorized classes, students, roll calls, and gradebook entries.
4. **Immutable Audit Logs**: Audit logs can be appended by authenticated users in their school, but never modified or deleted.

---

## 📋 Comprehensive Feature Matrix

### 1. 🏢 Admin Hub (`/admin`)
- **Executive Dashboard**: Live KPI metrics (Students, Teachers, Classes, Fees Collected, Outstanding Dues, Attendance Rate) & dynamic Class-Wise Collection Snapshot.
- **Student Information System (`/admin/students`)**: Searchable, filterable student roster with links to dossiers.
- **Student Enrollment Engine (`/admin/students/new`)**: Multi-section admission wizard with automated user account creation, admission ID (`STD-2024-XXX`), and initial fee challan.
- **Student Master Dossier (`/admin/students/[id]`)**: 5 interactive tabs (Overview, Attendance History, Fee Ledger, Report Card with GPA calculations, Observations).
- **Faculty Management (`/admin/teachers`)**: Teacher roster, qualifications, department allocations, and teaching loads.
- **Classes & Curriculum (`/admin/classes`)**: Class cohort cards, incharge teachers, and syllabus subject management.
- **Daily Attendance Register (`/admin/attendance`)**: Live roll call taking with one-click "Mark All Present" and database persistence.
- **Fee Management & Cashier Counter (`/admin/fees`)**: Institution-wide financial metrics, filters, and cashier payment recording modal.
- **Examinations & Rapid Gradebook (`/admin/exams`)**: Term management, schedules, and rapid marks entry with live auto-computation of Percentage, Grade, and GPA.
- **Reports & Academic Analytics (`/admin/reports`)**: Class-wise attendance, revenue collection summaries, and grade distribution.
- **Records Vault & System Audit (`/admin/locked-records`, `/admin/audit`)**: Sealed transcripts and chronological audit trail.
- **Settings (`/admin/settings`)**: School profile, branding, and grading parameters.

### 2. 👩‍🏫 Teacher Portal (`/teacher`)
- **Daily Timetable**: Period schedule with active period indicators.
- **Classroom Roll Call**: Rapid attendance register with live counters.
- **Rapid Gradebook**: Subject mark sheets with inline marks entry and dynamic grade calculation.
- **Student Roster & Observations**: Student roster with observation logging.

### 3. 🎓 Student Portal (`/student`)
- **Student Dashboard**: Term GPA, attendance rate, fee balance, and commendations.
- **Biodata Profile**: Student particulars and guardian information.
- **Attendance History**: Monthly stats and daily history log.
- **Fee Challans & Receipts**: Challans, payment receipts, and balance status.
- **Official Report Card**: Printable institutional transcript with school header and seals.
