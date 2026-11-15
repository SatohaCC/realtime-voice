import { expect, test } from "@playwright/test";

test("トップページから仕組みページへ移動できる", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("banner").getByRole("link", { name: "Realtime Voice" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "対話を止めずに、薬歴の土台をその場で。",
  );
  const startLink = page.getByRole("link", { name: "文字起こしを始める" });
  await expect(startLink).toHaveAttribute("href", "/transcription");
  await page.getByRole("link", { name: "仕組みを見る", exact: true }).click();
  await expect(page).toHaveURL(/\/mechanism$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "リアルタイム文字起こし・SOAP 自動生成の仕組み",
  );
});

for (const path of ["/", "/mechanism"]) {
  test(`${path} は狭い画面とダークテーマでも収まり、モーションを低減できる`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const link = page.getByRole("link", {
      name: path === "/" ? "文字起こしを始める" : "文字起こし画面へ",
    });
    await expect(link).toBeVisible();
    await expect(link).toHaveCSS("transition-duration", "0s");
  });
}

test("バックエンドのヘルスAPIは正常応答を返す", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toEqual({ status: "ok", service: "realtime-voice-backend" });
});
