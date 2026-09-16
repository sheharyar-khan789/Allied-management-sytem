import {
  getStudentsServer,
  getTeachersServer,
  getClassesServer,
  getSubjectsServer,
  getAttendanceServer,
  getFeeChallansServer,
  getPaymentsServer,
  getExamsServer,
  getExamResultsServer,
  getStudentObservationsServer,
  getAuditLogsServer,
  getLockedRecordsServer,
  getSchoolSettingsServer,
} from "../src/lib/firebase/server-db";

const DEFAULT_SCHOOL = "allied-school-main";

async function main() {
  console.log("==================================================");
  console.log("  ALLIED SCHOOL SYSTEM FIREBASE HEALTH CHECK     ");
  console.log("==================================================");

  try {
    const [
      students,
      teachers,
      classes,
      subjects,
      attendance,
      challans,
      payments,
      exams,
      results,
      observations,
      auditLogs,
      lockedRecords,
      settings
    ] = await Promise.all([
      getStudentsServer(DEFAULT_SCHOOL),
      getTeachersServer(DEFAULT_SCHOOL),
      getClassesServer(DEFAULT_SCHOOL),
      getSubjectsServer(DEFAULT_SCHOOL),
      getAttendanceServer(DEFAULT_SCHOOL),
      getFeeChallansServer(DEFAULT_SCHOOL),
      getPaymentsServer(DEFAULT_SCHOOL),
      getExamsServer(DEFAULT_SCHOOL),
      getExamResultsServer(DEFAULT_SCHOOL),
      getStudentObservationsServer(DEFAULT_SCHOOL, "std-1"),
      getAuditLogsServer(DEFAULT_SCHOOL),
      getLockedRecordsServer(DEFAULT_SCHOOL),
      getSchoolSettingsServer(DEFAULT_SCHOOL)
    ]);

    console.log(`[+] Enrolled Students:        ${students.length}`);
    console.log(`[+] Faculty Teachers:         ${teachers.length}`);
    console.log(`[+] Academic Classes:         ${classes.length}`);
    console.log(`[+] Curriculum Subjects:      ${subjects.length}`);
    console.log(`[+] Attendance Records:       ${attendance.length}`);
    console.log(`[+] Fee Challans Issued:      ${challans.length}`);
    console.log(`[+] Fee Payments Recorded:    ${payments.length}`);
    console.log(`[+] Examination Cycles:       ${exams.length}`);
    console.log(`[+] Exam Results / Marks:     ${results.length}`);
    console.log(`[+] Behavioral Observations:  ${observations.length}`);
    console.log(`[+] System Audit Logs:        ${auditLogs.length}`);
    console.log(`[+] Locked Records:           ${lockedRecords.length}`);
    console.log(`[+] School Settings Config:   ${settings ? "Active" : "Default"}`);

    // Fee calculations
    let totalExpected = 0;
    let totalPaid = 0;
    challans.forEach((c) => {
      totalExpected += c.totalExpected || 0;
      totalPaid += c.paidAmount || 0;
    });
    const totalOutstanding = Math.max(0, totalExpected - totalPaid);
    const recoveryRate = totalExpected > 0 ? ((totalPaid / totalExpected) * 100).toFixed(1) : "0";

    console.log("--------------------------------------------------");
    console.log(`[+] Total Fees Invoiced:      Rs. ${totalExpected.toLocaleString()}`);
    console.log(`[+] Total Fees Collected:     Rs. ${totalPaid.toLocaleString()}`);
    console.log(`[+] Total Outstanding Dues:   Rs. ${totalOutstanding.toLocaleString()}`);
    console.log(`[+] Fee Recovery Rate:        ${recoveryRate}%`);

    console.log("==================================================");
    console.log("  ALL FIREBASE COMPONENTS FULLY OPERATIONAL       ");
    console.log("==================================================");
  } catch (error) {
    console.error("Health check error:", error);
    process.exit(1);
  }
}

main();
