import * as stylex from "@stylexjs/stylex";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { QueryProvider } from "@/shared/lib/query/QueryProvider";
import { getServerAuthUser } from "@/shared/lib/supabase/server";
import { AppHeader } from "./_components/AppHeader";
import "./globals.css";
import { layoutStyles } from "./layout.styles";

export const metadata: Metadata = {
  title: "Realtime Voice | 薬局服薬指導 リアルタイム文字起こし・SOAP支援",
  description:
    "患者・薬剤師の2マイク音声をリアルタイム文字起こしし、根拠付きの S・O・P・A 薬歴下書きを自動生成するワークスペース。",
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const user = await getServerAuthUser();

  return (
    <html lang="ja">
      <body {...stylex.props(layoutStyles.body)}>
        <QueryProvider>
          <AppHeader initialUser={user} />
          {children}
        </QueryProvider>
      </body>
    </html>
  );
}
