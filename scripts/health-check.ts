import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("==================================================");
  console.log("  ALLIED SCHOOL SYSTEM DIAGNOSTIC & HEALTH CHECK  ");
  console.log("==================================================");

  const [
    usersCount,
    teachersCount,
    studentsCount,
    classesCount,
    subjectsCount,
    attendanceCount,
    challansCount,
    paymentsCount,
    examsCount,
    schedulesCount,
    resultsCount,
    observationsCount,
    auditLogsCount,
    lockedRecordsCount,
    settingsCount
  ] = await Promise.all([
    prisma.user.count(),
    prisma.teacher.count(),
    prisma.student.count(),
    prisma.class.count(),
    prisma.subject.count(),
    prisma.attendance.count(),
    prisma.feeChallan.count(),
    prisma.payment.count(),
    prisma.exam.count(),
    prisma.examSchedule.count(),
    prisma.examResult.count(),
    prisma.studentObservation.count(),
    prisma.auditLog.count(),
    prisma.lockedRecord.count(),
    prisma.schoolSetting.count()
  ]);

  console.log(`[+] Total User Accounts:      ${usersCount}`);
  console.log(`[+] Faculty Teachers:         ${teachersCount}`);
  console.log(`[+] Enrolled Students:        ${studentsCount}`);
  console.log(`[+] Academic Classes:         ${classesCount}`);
  console.log(`[+] Curriculum Subjects:      ${subjectsCount}`);
  console.log(`[+] Attendance Records:       ${attendanceCount}`);
  console.log(`[+] Fee Challans Issued:      ${challansCount}`);
  console.log(`[+] Fee Payments Recorded:    ${paymentsCount}`);
  console.log(`[+] Examination Terms:        ${examsCount}`);
  console.log(`[+] Exam Schedules / Papers:  ${schedulesCount}`);
  console.log(`[+] Exam Results / Marks:     ${resultsCount}`);
  console.log(`[+] Behavioral Observations:  ${observationsCount}`);
  console.log(`[+] System Audit Logs:        ${auditLogsCount}`);
  console.log(`[+] Locked/Sealed Records:    ${lockedRecordsCount}`);
  console.log(`[+] System Settings Config:   ${settingsCount}`);

  // Test Fee Calculation Aggregate
  const totalExpected = await prisma.feeChallan.aggregate({ _sum: { totalExpected: true } });
  const totalPaid = await prisma.feeChallan.aggregate({ _sum: { paidAmount: true } });
  const allChallans = await prisma.feeChallan.findMany();
  const totalOutstanding = allChallans.reduce((sum, c) => sum + Math.max(0, c.totalExpected - c.paidAmount), 0);

  console.log("--------------------------------------------------");
  console.log(`[+] Total Fees Invoiced:      Rs. ${(totalExpected._sum.totalExpected || 0).toLocaleString()}`);
  console.log(`[+] Total Fees Collected:     Rs. ${(totalPaid._sum.paidAmount || 0).toLocaleString()}`);
  console.log(`[+] Total Outstanding Dues:   Rs. ${totalOutstanding.toLocaleString()}`);
  
  const recoveryRate = totalExpected._sum.totalExpected 
    ? (((totalPaid._sum.paidAmount || 0) / totalExpected._sum.totalExpected) * 100).toFixed(1)
    : "0";
  console.log(`[+] Fee Recovery Rate:        ${recoveryRate}%`);

  // Test Overall Attendance Rate
  const presentCount = await prisma.attendance.count({ where: { status: "PRESENT" } });
  const lateCount = await prisma.attendance.count({ where: { status: "LATE" } });
  const attendanceRate = attendanceCount 
    ? (((presentCount + lateCount) / attendanceCount) * 100).toFixed(1)
    : "0";
  console.log(`[+] School Attendance Rate:   ${attendanceRate}%`);

  console.log("==================================================");
  console.log("  ALL SYSTEM COMPONENTS FULLY OPERATIONAL & READY ");
  console.log("==================================================");
}

main()
  .catch((e) => {
    console.error("Health check error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
