import { expect, it } from "vitest";
import { AudioLevelHistory } from "./audioLevelHistory";
import {
  applyDeepgramTranscriptEvent,
  createInitialTranscriptState,
  startTranscriptSession,
} from "./transcriptReducer";

it("認識結果の時刻で音量を引き、後から続いた無音の影響を受けない", () => {
  const history = new AudioLevelHistory();
  history.append({
    pcm16: new ArrayBuffer(6400),
    channels: 2,
    sampleRate: 16000,
    levels: [0.4, 0.08],
  });
  history.append({ pcm16: new ArrayBuffer(6400), channels: 2, sampleRate: 16000, levels: [0, 0] });
  expect(history.levelsFor(0, 0.1)[0]).toBeCloseTo(0.4);
  expect(history.levelsFor(0, 0.1)[1]).toBeCloseTo(0.08);
  expect(history.levelsFor(0, 1)).toEqual([0, 0]);
});
it("再接続後の同時刻の発話を過去のセッションと重複判定しない", () => {
  const event = {
    channelIndex: 0 as const,
    text: "はい",
    isFinal: true,
    speechFinal: true,
    startSec: 0,
    endSec: 1,
    confidence: 1,
  };
  const labels = { 0: "A", 1: "B" };
  const old = applyDeepgramTranscriptEvent(createInitialTranscriptState(), event, labels);
  const next = applyDeepgramTranscriptEvent(
    startTranscriptSession(old),
    { ...event, channelIndex: 1 },
    labels,
    [0.4, 0.08],
  );
  expect(next.segments).toHaveLength(2);
});
