import * as stylex from "@stylexjs/stylex";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { UserProfileContainer } from "@/features/user/UserProfileContainer";
import { getServerAuthUser } from "@/shared/lib/supabase/server";
import { userPageStyles as s } from "./user.styles";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ユーザー設定 | Realtime Voice",
  description: "ログインアカウント情報の確認と、薬剤師声紋（端末ローカル）の事前登録を行います。",
};

export default async function UserPage() {
  const user = await getServerAuthUser();
  if (!user) {
    redirect("/login?next=/user");
  }

  return (
    <main id="main-content" tabIndex={-1} {...stylex.props(s.main)}>
      <header {...stylex.props(s.header)}>
        <h1 {...stylex.props(s.title)}>ユーザー設定</h1>
        <p {...stylex.props(s.lead)}>
          ログイン中のアカウント確認と、2マイク話者分離に使う薬剤師声紋の登録を行います。
        </p>
      </header>
      <UserProfileContainer key={user.userId} initialUserId={user.userId} />
    </main>
  );
}
