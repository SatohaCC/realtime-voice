import * as stylex from "@stylexjs/stylex";
import { redirect } from "next/navigation";
import { LoginContainer } from "@/features/auth/LoginContainer";
import { sanitizeRedirectPath } from "@/shared/lib/supabase/config";
import { getServerAuthUser } from "@/shared/lib/supabase/server";
import { loginPageStyles as s } from "./login.styles";

export const dynamic = "force-dynamic";

interface LoginPageProps {
  searchParams: Promise<{ next?: string; error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const nextPath = sanitizeRedirectPath(params.next);
  const user = await getServerAuthUser();

  if (user) {
    redirect(nextPath);
  }

  return (
    <main id="main-content" tabIndex={-1} {...stylex.props(s.main)}>
      <LoginContainer initialErrorCode={params.error ?? null} nextPath={nextPath} />
    </main>
  );
}
