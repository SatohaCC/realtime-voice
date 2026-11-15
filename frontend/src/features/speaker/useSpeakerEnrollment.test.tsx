import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSpeakerEnrollment } from "./useSpeakerEnrollment";

const mocks = vi.hoisted(() => ({
  getBrowserAuthUser: vi.fn(),
  getValidAccessToken: vi.fn(),
  subscribeAuthState: vi.fn(() => () => {}),
  loadPharmacistVoiceprint: vi.fn(),
  savePharmacistVoiceprint: vi.fn(),
  deletePharmacistVoiceprint: vi.fn(),
  enrollPharmacistVoice: vi.fn(),
}));

vi.mock("@/shared/lib/supabase/client", () => ({
  getBrowserAuthUser: mocks.getBrowserAuthUser,
  getValidAccessToken: mocks.getValidAccessToken,
  subscribeAuthState: mocks.subscribeAuthState,
}));

vi.mock("@/shared/lib/speaker/voiceprintStore", () => ({
  loadPharmacistVoiceprint: mocks.loadPharmacistVoiceprint,
  savePharmacistVoiceprint: mocks.savePharmacistVoiceprint,
  deletePharmacistVoiceprint: mocks.deletePharmacistVoiceprint,
}));

vi.mock("@/shared/lib/speaker/enrollSpeakerClient", () => ({
  enrollPharmacistVoice: mocks.enrollPharmacistVoice,
}));

describe("useSpeakerEnrollment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBrowserAuthUser.mockResolvedValue({ userId: "pharm-1", email: "a@example.com" });
    mocks.getValidAccessToken.mockResolvedValue("tok-1");
    mocks.loadPharmacistVoiceprint.mockResolvedValue(null);
    mocks.savePharmacistVoiceprint.mockResolvedValue(true);
    mocks.deletePharmacistVoiceprint.mockResolvedValue(undefined);
    mocks.enrollPharmacistVoice.mockResolvedValue({
      model_id: "campp-v1",
      embedding_dim: 4,
      embedding: [0.5, 0.5, 0.5, 0.5],
      duration_sec: 4.0,
      voiced_sec: 3.4,
      rms_level: 0.08,
      peak_level: 0.2,
      quality_warnings: [],
    });
  });

  it("ユーザー紐づけで声紋を登録・IndexedDB保存・削除できる", async () => {
    const { result } = renderHook(() => useSpeakerEnrollment());

    await waitFor(() => {
      expect(result.current.userId).toBe("pharm-1");
    });
    expect(mocks.loadPharmacistVoiceprint).toHaveBeenCalledWith("pharm-1");

    await act(async () => {
      await result.current.enroll("mic-1");
    });

    expect(mocks.savePharmacistVoiceprint).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "pharm-1",
        modelId: "campp-v1",
        embedding: [0.5, 0.5, 0.5, 0.5],
      }),
    );
    expect(result.current.voiceprint?.modelId).toBe("campp-v1");
    expect(mocks.enrollPharmacistVoice).toHaveBeenCalledWith(
      expect.objectContaining({
        durationMs: 10000,
        minVoicedSeconds: 3,
        sampleCount: 3,
        onSample: expect.any(Function),
      }),
    );

    await act(async () => {
      await result.current.clear();
    });

    expect(mocks.deletePharmacistVoiceprint).toHaveBeenCalledWith("pharm-1");
    expect(result.current.voiceprint).toBeNull();
  });
});
