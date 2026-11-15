import { expect, test } from "@playwright/test";

test("トップページでバックエンドのヘルスステータスを表示・更新できる", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("banner").getByRole("link", { name: "Realtime Voice" }),
  ).toBeVisible();
  await expect(page.getByText("Backend API")).toBeVisible();
  await expect(page.getByText("ok (realtime-voice-backend)")).toBeVisible();

  const refreshed = page.waitForResponse((response) => response.url().endsWith("/api/health"));
  await page.getByRole("button", { name: "Refresh Status" }).click();
  expect((await refreshed).ok()).toBeTruthy();
  await expect(page.getByText("ok (realtime-voice-backend)")).toBeVisible();
});

test("狭い画面とダークテーマでも内容が収まり、モーションを低減できる", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  await expect(
    page.getByRole("banner").getByRole("link", { name: "Realtime Voice" }),
  ).toBeVisible();
  await expect(page.locator("main")).toHaveCSS("padding-left", "20px");
  await expect(page.getByRole("button", { name: "Refresh Status", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(page.getByRole("button", { name: "Refresh Status", exact: true })).toHaveCSS(
    "transition-duration",
    "0s",
  );
});

test("APIの失敗を表示し、更新操作で復帰できる", async ({ page }) => {
  let healthy = false;
  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      status: healthy ? 200 : 503,
      contentType: "application/json",
      body: JSON.stringify(
        healthy ? { status: "ok", service: "realtime-voice-backend" } : { detail: "unavailable" },
      ),
    });
  });
  await page.goto("/");
  await expect(page.getByRole("status").filter({ hasText: "Error: HTTP 503" })).toBeVisible();
  healthy = true;
  await page.getByRole("button", { name: "Refresh Status" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "ok (realtime-voice-backend)" }),
  ).toBeVisible();
});
