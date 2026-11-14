import * as stylex from "@stylexjs/stylex";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { QueryProvider } from "@/shared/lib/query/QueryProvider";
import { AppHeader } from "./_components/AppHeader";
import "./globals.css";
import { layoutStyles } from "./layout.styles";

export const metadata: Metadata = {
  title: "Realtime Voice",
  description: "Next.js + FastAPI starter template",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ja">
      <body {...stylex.props(layoutStyles.body)}>
        <QueryProvider>
          <AppHeader />
          {children}
        </QueryProvider>
      </body>
    </html>
  );
}
