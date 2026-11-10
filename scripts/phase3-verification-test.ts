import { NextRequest } from "next/server";
import { GET as parentChildrenHandler } from "../src/app/api/parent/children/route";
import { GET as parentChildHandler } from "../src/app/api/parent/child/[id]/route";
import { GET as announcementsGet, POST as announcementsPost } from "../src/app/api/announcements/route";
import { GET as printChallanHandler } from "../src/app/api/print/challan/[id]/route";
import { GET as printReportHandler } from "../src/app/api/print/report-card/[studentId]/route";
import { GET as printAttendanceHandler } from "../src/app/api/print/attendance/[studentId]/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import { announcementVisibleToRole } from "../src/lib/announcements-visibility";
import { getLinkedChildrenForParent, parentOwnsStudentId } from "../src/lib/parent-access";
import {
  createUserServer,
  saveStudentServer,
  saveAnnouncementServer,
  saveFeeChallanServer,
} from "../src/lib/firebase/server-db";
import { AnnouncementDoc, FeeChallanDoc, StudentDoc, UserProfile } from "../src/lib/firebase/types";

async function run() {
  console.log("==================================================");
  console.log("PHASE 3 VERIFICATION: PARENT / ANNOUNCE / PRINT");
  console.log("==================================================");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, name: string) {
    if (condition) {
      console.log(`[PASS] ${name}`);
      passed++;
    } else {
      console.error(`[FAIL] ${name}`);
      failed++;
    }
  }

  const schoolA = "allied-school-main";
  const schoolB = "school-beta-phase3";
  const now = new Date().toISOString();

  const parentA: UserProfile = {
    uid: "usr-parent-phase3-a",
    email: "parent-a-phase3@example.com",
    name: "Parent A",
    role: "PARENT",
    schoolId: schoolA,
    studentIds: ["std-phase3-a"],
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  };
  const parentB: UserProfile = {
    uid: "usr-parent-phase3-b",
    email: "parent-b-phase3@example.com",
    name: "Parent B",
    role: "PARENT",
    schoolId: schoolA,
    studentIds: ["std-phase3-b"],
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  };
  const parentOtherSchool: UserProfile = {
    uid: "usr-parent-phase3-c",
    email: "parent-c-phase3@example.com",
    name: "Parent C",
    role: "PARENT",
    schoolId: schoolB,
    studentIds: ["std-phase3-c"],
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  };

  const childA: StudentDoc = {
    id: "std-phase3-a",
    schoolId: schoolA,
    admissionNo: "P3-A",
    fullName: "Child A",
    fatherName: "Parent A",
    gender: "MALE",
    classId: "cls-10a",
    className: "Class 10-A",
    section: "A",
    rollNo: "21",
    status: "ACTIVE",
    guardianName: "Parent A",
    guardianPhone: "03000000001",
    guardianRelation: "Father",
    guardianEmail: parentA.email,
    parentUserIds: [parentA.uid],
    monthlyFee: 0,
    discount: 0,
    createdAt: now,
    updatedAt: now,
  };
  const childB: StudentDoc = {
    ...childA,
    id: "std-phase3-b",
    admissionNo: "P3-B",
    fullName: "Child B",
    fatherName: "Parent B",
    guardianName: "Parent B",
    guardianEmail: parentB.email,
    parentUserIds: [parentB.uid],
    rollNo: "22",
  };
  const childC: StudentDoc = {
    ...childA,
    id: "std-phase3-c",
    schoolId: schoolB,
    admissionNo: "P3-C",
    fullName: "Child C",
    guardianEmail: parentOtherSchool.email,
    parentUserIds: [parentOtherSchool.uid],
  };

  await createUserServer(parentA);
  await createUserServer(parentB);
  await createUserServer(parentOtherSchool);
  await saveStudentServer(childA);
  await saveStudentServer(childB);
  await saveStudentServer(childC);

  const linkedA = await getLinkedChildrenForParent(schoolA, parentA.uid);
  assert(
    linkedA.length === 1 && linkedA[0].id === "std-phase3-a",
    "Parent A linked children contain only Child A"
  );
  assert(
    !(await parentOwnsStudentId(schoolA, parentA.uid, "std-phase3-b")),
    "Parent A does not own Parent B child"
  );
  assert(
    !(await parentOwnsStudentId(schoolA, parentA.uid, "std-phase3-c")),
    "Parent A cannot own School B child"
  );

  const parentAToken = await createSessionCookieServer({
    uid: parentA.uid,
    email: parentA.email,
    role: "PARENT",
    schoolId: schoolA,
    name: parentA.name,
    studentIds: ["std-phase3-b"],
  });
  const parentBToken = await createSessionCookieServer({
    uid: parentB.uid,
    email: parentB.email,
    role: "PARENT",
    schoolId: schoolA,
    name: parentB.name,
  });
  const parentCToken = await createSessionCookieServer({
    uid: parentOtherSchool.uid,
    email: parentOtherSchool.email,
    role: "PARENT",
    schoolId: schoolB,
    name: parentOtherSchool.name,
  });
  const adminToken = await createSessionCookieServer({
    uid: "usr-admin-phase3",
    email: "admin-phase3@example.com",
    role: "ADMIN",
    schoolId: schoolA,
    name: "Admin",
  });
  const teacherToken = await createSessionCookieServer({
    uid: "usr-teacher-1",
    email: "teacher@alliedschool.edu",
    role: "TEACHER",
    schoolId: schoolA,
    name: "Teacher",
    teacherId: "tch-1",
  });
  const studentToken = await createSessionCookieServer({
    uid: "usr-student-1",
    email: "student@alliedschool.edu",
    role: "STUDENT",
    schoolId: schoolA,
    name: "Student",
    studentId: "std-1",
  });

  {
    const req = new NextRequest("http://localhost:3000/api/parent/children", {
      headers: { cookie: `allied_session=${parentAToken}` },
    });
    const res = await parentChildrenHandler(req);
    const data = await res.json();
    const ids = (data.children || []).map((c: { id: string }) => c.id);
    assert(
      res.status === 200 && ids.includes("std-phase3-a") && !ids.includes("std-phase3-b") && !ids.includes("std-1"),
      "GET /api/parent/children returns only Parent A linked children (JWT studentIds ignored)"
    );
  }

  {
    const req = new NextRequest("http://localhost:3000/api/parent/child/std-phase3-b", {
      headers: { cookie: `allied_session=${parentAToken}` },
    });
    const res = await parentChildHandler(req, { params: Promise.resolve({ id: "std-phase3-b" }) });
    assert(res.status === 403, "Parent A cannot load Parent B child academic payload (403)");
  }

  {
    const req = new NextRequest("http://localhost:3000/api/parent/child/std-phase3-a", {
      headers: { cookie: `allied_session=${parentBToken}` },
    });
    const res = await parentChildHandler(req, { params: Promise.resolve({ id: "std-phase3-a" }) });
    assert(res.status === 403, "Parent B cannot load Parent A child academic payload (403)");
  }

  {
    const req = new NextRequest("http://localhost:3000/api/parent/children", {
      headers: { cookie: `allied_session=${parentCToken}` },
    });
    const res = await parentChildrenHandler(req);
    const data = await res.json();
    const ids = (data.children || []).map((c: { id: string }) => c.id);
    assert(
      res.status === 200 && ids.includes("std-phase3-c") && !ids.includes("std-phase3-a"),
      "School B parent cannot see School A children"
    );
  }

  const teacherOnly: AnnouncementDoc = {
    id: "ann-phase3-teachers",
    schoolId: schoolA,
    title: "Staff only",
    message: "Teachers meeting",
    audience: "TEACHERS",
    status: "PUBLISHED",
    publishedAt: now,
    createdBy: "usr-admin-phase3",
    createdAt: now,
    updatedAt: now,
  };
  const parentOnly: AnnouncementDoc = {
    ...teacherOnly,
    id: "ann-phase3-parents",
    title: "Parents only",
    message: "Fee reminder",
    audience: "PARENTS",
  };
  const draft: AnnouncementDoc = {
    ...teacherOnly,
    id: "ann-phase3-draft",
    title: "Draft",
    message: "Not live",
    audience: "EVERYONE",
    status: "DRAFT",
    publishedAt: undefined,
  };
  const otherSchoolAnn: AnnouncementDoc = {
    ...parentOnly,
    id: "ann-phase3-schoolb",
    schoolId: schoolB,
    title: "School B notice",
  };
  await saveAnnouncementServer(teacherOnly);
  await saveAnnouncementServer(parentOnly);
  await saveAnnouncementServer(draft);
  await saveAnnouncementServer(otherSchoolAnn);

  assert(announcementVisibleToRole(teacherOnly, "TEACHER") === true, "Teachers see TEACHERS audience");
  assert(announcementVisibleToRole(teacherOnly, "PARENT") === false, "Parents do not see TEACHERS audience");
  assert(announcementVisibleToRole(parentOnly, "PARENT") === true, "Parents see PARENTS audience");
  assert(announcementVisibleToRole(parentOnly, "STUDENT") === false, "Students do not see PARENTS audience");
  assert(announcementVisibleToRole(draft, "PARENT") === false, "Non-admin cannot see drafts");
  assert(announcementVisibleToRole(draft, "ADMIN") === true, "Admin can see drafts");

  {
    const req = new NextRequest("http://localhost:3000/api/announcements", {
      headers: { cookie: `allied_session=${parentAToken}` },
    });
    const res = await announcementsGet(req);
    const data = await res.json();
    const titles = (data.announcements || []).map((a: { title: string }) => a.title);
    assert(
      res.status === 200 &&
        titles.includes("Parents only") &&
        !titles.includes("Staff only") &&
        !titles.includes("Draft") &&
        !titles.includes("School B notice"),
      "Parent announcement feed is audience- and school-scoped"
    );
  }

  {
    const req = new NextRequest("http://localhost:3000/api/announcements", {
      method: "POST",
      headers: { cookie: `allied_session=${parentAToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Hack", message: "nope", audience: "EVERYONE", status: "PUBLISHED" }),
    });
    const res = await announcementsPost(req);
    assert(res.status === 403, "Parent cannot create announcements (403)");
  }

  {
    const req = new NextRequest("http://localhost:3000/api/announcements", {
      method: "POST",
      headers: { cookie: `allied_session=${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Campus notice",
        message: "Holiday tomorrow",
        audience: "EVERYONE",
        status: "PUBLISHED",
        schoolId: schoolB,
      }),
    });
    const res = await announcementsPost(req);
    const data = await res.json();
    assert(
      res.status === 201 && data.announcement?.title === "Campus notice",
      "Admin can create school-scoped announcement (client schoolId ignored)"
    );
  }

  const challanA: FeeChallanDoc = {
    id: "ch-phase3-a",
    schoolId: schoolA,
    studentId: "std-phase3-a",
    studentName: "Child A",
    admissionNo: "P3-A",
    classId: "cls-10a",
    className: "Class 10-A",
    challanNo: "CH-P3-A",
    month: "September",
    year: 2026,
    issueDate: "2026-09-01",
    dueDate: "2026-09-15",
    tuitionFee: 1000,
    admissionFee: 0,
    examFee: 0,
    otherFee: 0,
    discount: 0,
    totalExpected: 1000,
    paidAmount: 0,
    balanceAmount: 1000,
    status: "PENDING",
    createdAt: now,
    updatedAt: now,
  };
  await saveFeeChallanServer(challanA);

  {
    const req = new NextRequest("http://localhost:3000/api/print/challan/ch-phase3-a", {
      headers: { cookie: `allied_session=${parentAToken}` },
    });
    const res = await printChallanHandler(req, { params: Promise.resolve({ id: "ch-phase3-a" }) });
    const data = await res.json();
    assert(
      res.status === 200 && data.challan?.challanNo === "CH-P3-A" && data.student?.fullName === "Child A",
      "Parent A can print linked child fee challan"
    );
  }

  {
    const req = new NextRequest("http://localhost:3000/api/print/challan/ch-phase3-a", {
      headers: { cookie: `allied_session=${parentBToken}` },
    });
    const res = await printChallanHandler(req, { params: Promise.resolve({ id: "ch-phase3-a" }) });
    assert(res.status === 403, "Parent B cannot print Parent A child challan (403)");
  }

  {
    const req = new NextRequest("http://localhost:3000/api/print/report-card/std-phase3-a", {
      headers: { cookie: `allied_session=${parentAToken}` },
    });
    const res = await printReportHandler(req, { params: Promise.resolve({ studentId: "std-phase3-a" }) });
    const data = await res.json();
    assert(res.status === 200 && data.student?.id === "std-phase3-a", "Parent A can load linked child report card");
  }

  {
    const req = new NextRequest("http://localhost:3000/api/print/attendance/std-phase3-b", {
      headers: { cookie: `allied_session=${parentAToken}` },
    });
    const res = await printAttendanceHandler(req, { params: Promise.resolve({ studentId: "std-phase3-b" }) });
    assert(res.status === 403, "Parent A cannot print Parent B attendance (403)");
  }

  {
    const req = new NextRequest("http://localhost:3000/api/print/report-card/std-1", {
      headers: { cookie: `allied_session=${teacherToken}` },
    });
    const res = await printReportHandler(req, { params: Promise.resolve({ studentId: "std-1" }) });
    assert(res.status === 200, "Assigned teacher can print report card for assigned-class student");
  }

  {
    const req = new NextRequest("http://localhost:3000/api/print/attendance/std-1", {
      headers: { cookie: `allied_session=${studentToken}` },
    });
    const res = await printAttendanceHandler(req, { params: Promise.resolve({ studentId: "std-1" }) });
    const data = await res.json();
    assert(res.status === 200 && data.student?.id === "std-1", "Student can print own attendance report");
  }

  console.log("\n==================================================");
  console.log(`PHASE 3 SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================\n");
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Phase 3 verification failed:", err);
  process.exit(1);
});
