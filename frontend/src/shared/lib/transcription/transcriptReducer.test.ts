import { expect, it } from "vitest";
import type { DeepgramTranscriptEvent } from "./deepgramClient";
import { applyDeepgramTranscriptEvent, createInitialTranscriptState } from "./transcriptReducer";

const labels = { 0: "A", 1: "B" };
const event: DeepgramTranscriptEvent = {
  channelIndex: 0,
  text: "はい",
  isFinal: true,
  speechFinal: true,
  startSec: 1,
  endSec: 1.2,
  confidence: 1,
};
it.each([
  [0, 0],
  [0.001, 0],
])("無音・低音量では別話者の同じ発話を残す (%j)", (left, right) => {
  const state = applyDeepgramTranscriptEvent(createInitialTranscriptState(), event, labels);
  const next = applyDeepgramTranscriptEvent(state, { ...event, channelIndex: 1 }, labels, [
    left,
    right,
  ]);
  expect(next.segments).toHaveLength(2);
});
it("時間が重ならない相槌を残す", () => {
  const state = applyDeepgramTranscriptEvent(createInitialTranscriptState(), event, labels);
  expect(
    applyDeepgramTranscriptEvent(
      state,
      { ...event, channelIndex: 1, startSec: 1.4, endSec: 1.6 },
      labels,
      [0.4, 0.08],
    ).segments,
  ).toHaveLength(2);
});
it("片方の発話が他方の文に含まれるだけでは除外しない", () => {
  const state = applyDeepgramTranscriptEvent(
    createInitialTranscriptState(),
    { ...event, text: "はい、そうです" },
    labels,
  );
  expect(
    applyDeepgramTranscriptEvent(state, { ...event, channelIndex: 1 }, labels, [0.4, 0.08])
      .segments,
  ).toHaveLength(2);
});
