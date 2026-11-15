import * as stylex from "@stylexjs/stylex";
import { redirect } from "next/navigation";
import { RealtimeTranscriptionContainer } from "@/features/transcription/RealtimeTranscriptionContainer";
import { getServerAuthUser } from "@/shared/lib/supabase/server";
import { transcriptionPageStyles as s } from "./transcription.styles";

export const dynamic = "force-dynamic";

export default async function TranscriptionPage() {
  const user = await getServerAuthUser();
  if (!user) {
    redirect("/login?next=/transcription");
  }

  return (
    <main id="main-content" tabIndex={-1} {...stylex.props(s.main)}>
      <div {...stylex.props(s.header)}>
        <h1 {...stylex.props(s.title)}>リアルタイム文字起こし · SOAP</h1>
        <p {...stylex.props(s.meta)}>AudioWorklet · Deepgram Nova-3</p>
      </div>
      <div {...stylex.props(s.workspaceShell)}>
        <RealtimeTranscriptionContainer />
      </div>
    </main>
  );
}
