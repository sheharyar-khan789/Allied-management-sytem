import { createAuditLogServer } from "./firebase/server-db";
import { getAuthenticatedUser } from "./firebase/server-auth";

export interface LogAuditParams {
  action: string;
  entity: string;
  entityId?: string;
  details: string;
  userId?: string;
  userName?: string;
  userRole?: string;
  ipAddress?: string;
}

export async function logAudit(params: LogAuditParams) {
  try {
    let userId = params.userId || "system";
    let userEmail = params.userName || "admin@alliedschool.edu";
    let userRole = params.userRole || "ADMIN";
    let schoolId = "allied-school-main";

    if (!params.userId) {
      const authUser = await getAuthenticatedUser();
      if (authUser) {
        userId = authUser.uid;
        userEmail = authUser.email;
        userRole = authUser.role;
        schoolId = authUser.schoolId;
      }
    }

    await createAuditLogServer(
      schoolId,
      userId,
      userEmail,
      userRole,
      params.action,
      params.entity,
      params.entityId || "",
      params.details
    );
  } catch (error) {
    console.error("Audit logging error:", error);
  }
}
