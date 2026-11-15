import { expect, test } from "@playwright/test";

test("SOAP 有効 WebSocket は未認証アクセスを拒否し、/transcription は保護と応答幅を維持する", async ({
  page,
}) => {
  for (const width of [1920, 390]) {
    await page.setViewportSize({ width, height: width === 1920 ? 1080 : 844 });
    await page.goto("/transcription");
    await expect(page).toHaveURL(/\/login\?next=%2Ftranscription/);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }

  // 未認証のブラウザコンテキストから soap=true WebSocket を開いても拒否される
  await page.goto("/");
  const wsResult = await page.evaluate(async () => {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const url = `${protocol}://127.0.0.1:8000/api/transcriptions/stream?mode=dual&soap=true&conversation_id=e2e-unauth`;
    return await new Promise<{ closed: boolean; code: number | null }>((resolve) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => resolve({ closed: false, code: null }), 5000);
      ws.addEventListener("close", (event) => {
        clearTimeout(timer);
        resolve({ closed: true, code: event.code });
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        resolve({ closed: true, code: null });
      });
    });
  });

  expect(wsResult.closed).toBe(true);
});
