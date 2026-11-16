import * as stylex from "@stylexjs/stylex";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PackageInsertSearchContainer } from "@/features/package-insert/PackageInsertSearchContainer";
import { getServerAuthUser } from "@/shared/lib/supabase/server";
import { searchPageStyles as s } from "./search.styles";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "添付文書検索 | Realtime Voice",
  description: "登録済みの電子添文からキーワードや医薬品・セクション別で根拠を検索します。",
};

export default async function SearchPage() {
  const user = await getServerAuthUser();
  if (!user) {
    redirect("/login?next=/search");
  }

  return (
    <main id="main-content" tabIndex={-1} {...stylex.props(s.main)}>
      <header {...stylex.props(s.header)}>
        <h1 {...stylex.props(s.title)}>添付文書キーワード検索</h1>
      </header>
      <PackageInsertSearchContainer />
    </main>
  );
}
