import * as stylex from "@stylexjs/stylex";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PackageInsertImportContainer } from "@/features/package-insert/PackageInsertImportContainer";
import { getServerAuthUser } from "@/shared/lib/supabase/server";
import { importsPageStyles as s } from "./imports.styles";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "添付文書 XML取り込み | Realtime Voice",
  description: "PMDA の電子添文 XML をアップロードして添付文書検索インデックスへ登録します。",
};

export default async function ImportsPage() {
  const user = await getServerAuthUser();
  if (!user) {
    redirect("/login?next=/imports");
  }

  return (
    <main id="main-content" tabIndex={-1} {...stylex.props(s.main)}>
      <header {...stylex.props(s.header)}>
        <h1 {...stylex.props(s.title)}>添付文書 XML を登録</h1>
        <p {...stylex.props(s.lead)}>
          PMDA から取得した電子添文 XML を登録すると、添付文書検索の対象に追加されます。
        </p>
      </header>
      <PackageInsertImportContainer />
    </main>
  );
}
