import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/firebase/server-auth";
import { getUserByIdServer } from "@/lib/firebase/server-db";

export async function GET(req: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser(req);
    if (!authUser) {
      return NextResponse.json({ user: null, session: null }, { status: 401 });
    }

    const profile = await getUserByIdServer(authUser.uid);
    const resolved = profile || authUser;
    return NextResponse.json({ user: resolved, session: resolved });
  } catch (error) {
    return NextResponse.json({ user: null, session: null }, { status: 500 });
  }
}
