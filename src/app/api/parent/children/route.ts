import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { getClassesServer } from "@/lib/firebase/server-db";
import { getLinkedChildrenForParent } from "@/lib/parent-access";

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["PARENT"]);
    const [children, classes] = await Promise.all([
      getLinkedChildrenForParent(authUser.schoolId, authUser.uid),
      getClassesServer(authUser.schoolId),
    ]);

    const classNameById = new Map(classes.map((c) => [c.id, `${c.name}${c.section ? `-${c.section}` : ""}`]));

    return NextResponse.json({
      success: true,
      parent: {
        uid: authUser.uid,
        name: authUser.name,
        email: authUser.email,
      },
      children: children
        .filter((c) => c.schoolId === authUser.schoolId)
        .map((c) => ({
          id: c.id,
          fullName: c.fullName,
          admissionNo: c.admissionNo,
          rollNo: c.rollNo,
          classId: c.classId,
          className: classNameById.get(c.classId) || c.className || "",
          section: c.section || "",
          status: c.status,
        })),
    });
  } catch (error: unknown) {
    if (error instanceof Response) return error;
    console.error("Parent children error:", error);
    return NextResponse.json({ error: "Failed to load linked children." }, { status: 500 });
  }
}
