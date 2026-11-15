import type { NextRequest } from "next/server";
import { handleAuthProxy } from "@/shared/lib/supabase/proxy";

/**
 * Next.js 16 Proxy として全リクエストの Supabase セッション更新と保護ルート制御を行う。
 */
export async function proxy(request: NextRequest) {
  return handleAuthProxy(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|worklets/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
