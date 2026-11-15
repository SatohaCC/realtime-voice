import { expect, test } from "@playwright/test";

test("トップページは公開維持され、保護された文字起こしページはログイン画面へ遷移する", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: /文字起こしを始める/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "仕組みを見る" })).toBeVisible();

  await page.goto("/mechanism");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "リアルタイム文字起こし・SOAP 自動生成の仕組み",
  );

  await page.goto("/transcription");
  await expect(page).toHaveURL(/\/login\?next=%2Ftranscription/);
  await expect(page.getByRole("heading", { name: "ログイン" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Google でログイン" })).toBeVisible();
  await expect(page.getByRole("button", { name: /でログイン$/ })).toHaveCount(1);
  const googleButton = page.getByRole("button", { name: "Google でログイン" });
  await expect(googleButton).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(googleButton).toHaveCSS("color", "rgb(31, 31, 31)");
  await expect(googleButton.locator("img")).toHaveAttribute("src", "/identity/google-g.png");
  await expect(googleButton.locator("img")).toBeVisible();
});

test("ログイン画面は狭い画面とダークテーマでも崩れず、キーボードで操作できる", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/login");

  await expect(page.getByRole("button", { name: "Google でログイン" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole("button", { name: "Google でログイン" }).focus();
  await expect(page.getByRole("button", { name: "Google でログイン" })).toBeFocused();
});

test("auth/callback 直接アクセスと logout のメソッド・Origin 保護が機能する", async ({
  page,
  request,
}) => {
  await page.goto("/auth/callback");
  await expect(page).toHaveURL(/\/login\?error=missing_code/);
  await expect(
    page.getByRole("alert").filter({ hasText: "認証コードが見つかりませんでした" }),
  ).toBeVisible();

  const getLogout = await request.get("/auth/logout");
  expect(getLogout.status()).toBe(405);

  const crossOriginPost = await request.post("/auth/logout", {
    headers: { origin: "https://evil.example" },
  });
  expect(crossOriginPost.status()).toBe(403);
});
