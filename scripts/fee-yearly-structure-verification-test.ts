import * as XLSX from "xlsx";
import {
  saveStudentServer,
  getStudentsServer,
  getYearlyFeeStructuresServer,
  getYearlyFeeStructureServer,
  commitYearlyFeeStructureDocsServer,
} from "../src/lib/firebase/server-db";
import { StudentDoc, YearlyFeeStructureDoc } from "../src/lib/firebase/types";
import { parseFeeStructureWorkbook, classifyFeeStructureRows, summarizeClassifiedRows } from "../src/lib/fee-structure-import";

function buildWorkbookBuffer(headers: string[], rows: any[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

const HEADERS = [
  "AdmissionNumber",
  "StudentName",
  "Class",
  "Section",
  "MonthlyTuitionFee",
  "AnnualFee",
  "AdmissionFee",
  "OtherCharges",
  "Discount",
  "Notes",
];

async function run() {
  console.log("==================================================");
  console.log("RUNNING AUTOMATED TEST SUITE: YEARLY FEE STRUCTURE (PHASE 2)");
  console.log("==================================================");

  let passed = 0;
  let total = 0;
  function assert(condition: boolean, name: string) {
    total++;
    if (condition) {
      console.log(`[PASS] Test ${total}: ${name}`);
      passed++;
    } else {
      console.error(`[FAIL] Test ${total}: ${name}`);
      process.exitCode = 1;
    }
  }

  const schoolId = "school-fee-structure-test-001";
  const academicYear = "2025-2026";
  const otherYear = "2026-2027";

  const student1: StudentDoc = {
    id: "std-fts-1",
    schoolId,
    admissionNo: "FT-001",
    fullName: "Zara Khan",
    fatherName: "Imran Khan",
    gender: "FEMALE",
    classId: "cls-5a",
    className: "Grade 5",
    section: "A",
    rollNo: "5",
    status: "ACTIVE",
    guardianName: "Imran Khan",
    guardianPhone: "03001112222",
    guardianRelation: "Father",
    monthlyFee: 0,
    discount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const student2: StudentDoc = { ...student1, id: "std-fts-2", admissionNo: "FT-002", fullName: "Bilal Ahmed", rollNo: "6" };
  await saveStudentServer(student1);
  await saveStudentServer(student2);

  const students = await getStudentsServer(schoolId);
  assert(students.length === 2, "Two test students seeded in isolated test school");

  // ----------------------------------------------------
  // TEST: New import creates records
  // ----------------------------------------------------
  const buf1 = buildWorkbookBuffer(HEADERS, [
    ["FT-001", "Zara Khan", "Grade 5", "A", 6000, 12000, 5000, 500, 0, ""],
    ["FT-002", "Bilal Ahmed", "Grade 5", "A", 6500, 12000, 5000, 500, 1000, ""],
  ]);
  const parsed1 = parseFeeStructureWorkbook(buf1, "import1.xlsx");
  assert(parsed1.length === 2, "Workbook parser extracts 2 data rows");

  const existingEmpty = new Map<string, YearlyFeeStructureDoc>();
  const classified1 = classifyFeeStructureRows(parsed1, students, existingEmpty);
  const summary1 = summarizeClassifiedRows(classified1);
  assert(summary1.createdCount === 2 && summary1.errorCount === 0, "First import classifies both rows as CREATED");

  const docs1: YearlyFeeStructureDoc[] = classified1
    .filter((r) => r.action === "CREATED")
    .map((r) => ({
      id: `${schoolId}__${academicYear}__${r.admissionNo}`,
      schoolId,
      academicYear,
      studentId: r.studentId!,
      admissionNo: r.admissionNo,
      studentName: r.studentName!,
      classId: r.classId || "",
      className: r.className,
      section: r.section,
      monthlyTuitionFee: r.structure!.monthlyTuitionFee,
      annualFee: r.structure!.annualFee,
      admissionFee: r.structure!.admissionFee,
      otherCharges: r.structure!.otherCharges,
      discount: r.structure!.discount,
      source: "IMPORT",
      createdAt: new Date().toISOString(),
      createdBy: "test-admin",
      updatedAt: new Date().toISOString(),
      updatedBy: "test-admin",
    }));
  await commitYearlyFeeStructureDocsServer(docs1);

  const afterFirstImport = await getYearlyFeeStructuresServer(schoolId, academicYear);
  assert(afterFirstImport.length === 2, "Two yearly fee structure docs persisted after first import");

  // ----------------------------------------------------
  // TEST: Re-uploading the same file is idempotent (no duplicates)
  // ----------------------------------------------------
  const existingAfterFirst = new Map(afterFirstImport.map((s) => [s.admissionNo, s]));
  const classifiedRepeat = classifyFeeStructureRows(parsed1, students, existingAfterFirst);
  const summaryRepeat = summarizeClassifiedRows(classifiedRepeat);
  assert(
    summaryRepeat.unchangedCount === 2 && summaryRepeat.createdCount === 0,
    "Re-uploading the identical file classifies all rows as UNCHANGED (idempotent, no duplicate writes)"
  );

  const afterRepeatImport = await getYearlyFeeStructuresServer(schoolId, academicYear);
  assert(afterRepeatImport.length === 2, "Document count unchanged after re-uploading identical file");

  // ----------------------------------------------------
  // TEST: Updated structure requires explicit update, shows diff
  // ----------------------------------------------------
  const buf2 = buildWorkbookBuffer(HEADERS, [["FT-001", "Zara Khan", "Grade 5", "A", 7000, 12000, 5000, 500, 0, ""]]);
  const parsed2 = parseFeeStructureWorkbook(buf2, "import2.xlsx");
  const classified2 = classifyFeeStructureRows(parsed2, students, existingAfterFirst);
  assert(
    classified2[0].action === "UPDATED" && classified2[0].previousValues?.monthlyTuitionFee === 6000,
    "Changed monthly fee is classified as UPDATED with correct previous value captured"
  );

  const updatedDoc: YearlyFeeStructureDoc = {
    ...existingAfterFirst.get("FT-001")!,
    monthlyTuitionFee: 7000,
    updatedAt: new Date().toISOString(),
    updatedBy: "test-admin",
  };
  await commitYearlyFeeStructureDocsServer([updatedDoc]);
  const afterUpdate = await getYearlyFeeStructureServer(schoolId, academicYear, "FT-001");
  assert(afterUpdate?.monthlyTuitionFee === 7000, "Updated monthly fee persisted for FT-001");

  const afterUpdateAll = await getYearlyFeeStructuresServer(schoolId, academicYear);
  assert(afterUpdateAll.length === 2, "No duplicate document created when updating an existing structure");

  // ----------------------------------------------------
  // TEST: Duplicate admission number within the same file is rejected
  // ----------------------------------------------------
  const bufDup = buildWorkbookBuffer(HEADERS, [
    ["FT-002", "Bilal Ahmed", "Grade 5", "A", 6500, 12000, 5000, 500, 1000, ""],
    ["FT-002", "Bilal Ahmed", "Grade 5", "A", 9999, 12000, 5000, 500, 1000, ""],
  ]);
  const parsedDup = parseFeeStructureWorkbook(bufDup, "dup.xlsx");
  const classifiedDup = classifyFeeStructureRows(parsedDup, students, existingAfterFirst);
  assert(
    classifiedDup.every((r) => r.action === "ERROR" && r.errorReason?.includes("Duplicate")),
    "Duplicate Admission Number within one file is rejected for all occurrences, never silently merged"
  );

  // ----------------------------------------------------
  // TEST: Unmatched admission number never auto-creates a student record
  // ----------------------------------------------------
  const bufUnmatched = buildWorkbookBuffer(HEADERS, [["FT-999", "Ghost Student", "Grade 5", "A", 6000, 0, 0, 0, 0, ""]]);
  const parsedUnmatched = parseFeeStructureWorkbook(bufUnmatched, "unmatched.xlsx");
  const classifiedUnmatched = classifyFeeStructureRows(parsedUnmatched, students, existingAfterFirst);
  assert(
    classifiedUnmatched[0].action === "ERROR" && !classifiedUnmatched[0].studentId,
    "Unmatched Admission Number is rejected, not silently matched by name or auto-created"
  );

  // ----------------------------------------------------
  // TEST: Invalid rows (missing / negative fee) rejected
  // ----------------------------------------------------
  const bufInvalid = buildWorkbookBuffer(HEADERS, [
    ["FT-001", "Zara Khan", "Grade 5", "A", "", 12000, 5000, 500, 0, ""],
    ["FT-002", "Bilal Ahmed", "Grade 5", "A", -500, 12000, 5000, 500, 0, ""],
  ]);
  const parsedInvalid = parseFeeStructureWorkbook(bufInvalid, "invalid.xlsx");
  const classifiedInvalid = classifyFeeStructureRows(parsedInvalid, students, existingAfterFirst);
  assert(
    classifiedInvalid.every((r) => r.action === "ERROR"),
    "Missing and negative fee amounts are both rejected as invalid records"
  );

  // ----------------------------------------------------
  // TEST: Academic-year separation — importing a new year never touches prior year's data
  // ----------------------------------------------------
  const bufYear2 = buildWorkbookBuffer(HEADERS, [["FT-001", "Zara Khan", "Grade 5", "A", 8000, 12000, 5000, 500, 0, ""]]);
  const parsedYear2 = parseFeeStructureWorkbook(bufYear2, "year2.xlsx");
  const existingYear2 = await getYearlyFeeStructuresServer(schoolId, otherYear);
  assert(existingYear2.length === 0, "New academic year starts with no structures (not inherited from prior year)");

  const classifiedYear2 = classifyFeeStructureRows(parsedYear2, students, new Map(existingYear2.map((s) => [s.admissionNo, s])));
  const year2Doc: YearlyFeeStructureDoc = {
    id: `${schoolId}__${otherYear}__FT-001`,
    schoolId,
    academicYear: otherYear,
    studentId: student1.id,
    admissionNo: "FT-001",
    studentName: student1.fullName,
    classId: student1.classId,
    monthlyTuitionFee: 8000,
    annualFee: 12000,
    admissionFee: 5000,
    otherCharges: 500,
    discount: 0,
    source: "IMPORT",
    createdAt: new Date().toISOString(),
    createdBy: "test-admin",
    updatedAt: new Date().toISOString(),
    updatedBy: "test-admin",
  };
  await commitYearlyFeeStructureDocsServer([year2Doc]);

  const year1After = await getYearlyFeeStructureServer(schoolId, academicYear, "FT-001");
  const year2After = await getYearlyFeeStructureServer(schoolId, otherYear, "FT-001");
  assert(
    year1After?.monthlyTuitionFee === 7000 && year2After?.monthlyTuitionFee === 8000,
    "Separate academic years hold independent fee structures for the same student"
  );

  console.log("==================================================");
  console.log(`TEST RESULTS: ${passed}/${total} TESTS PASSED`);
  console.log("==================================================");
}

run().catch((err) => {
  console.error("FATAL ERROR IN TEST SUITE:", err);
  process.exit(1);
});
