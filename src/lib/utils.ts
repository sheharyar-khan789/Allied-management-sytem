import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "Rs. 0";
  return `Rs. ${amount.toLocaleString("en-PK")}`;
}

export function calculateGrade(percentage: number): { grade: string; gpa: number; remarks: string } {
  if (percentage >= 90) return { grade: "A+", gpa: 4.0, remarks: "Outstanding / High Distinction" };
  if (percentage >= 80) return { grade: "A", gpa: 3.8, remarks: "Excellent Performance" };
  if (percentage >= 70) return { grade: "B+", gpa: 3.4, remarks: "Very Good" };
  if (percentage >= 60) return { grade: "B", gpa: 3.0, remarks: "Good / Satisfactory" };
  if (percentage >= 50) return { grade: "C", gpa: 2.0, remarks: "Average / Needs Improvement" };
  if (percentage >= 40) return { grade: "D", gpa: 1.0, remarks: "Pass" };
  return { grade: "F", gpa: 0.0, remarks: "Fail" };
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "N/A";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "N/A";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
