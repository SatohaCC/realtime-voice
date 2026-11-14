import { expect, test } from "@playwright/test";

test("タブは明暗テーマ・狭い幅でも選択でき、フォーカスと下線を表示する", async ({
  page,
}, testInfo) => {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 640 });
    for (const variant of ["primary", "secondary"]) {
      await page.goto(`/iframe.html?id=shared-ui-tabs--${variant}&viewMode=story`);
      const first = page.getByRole("tab", { name: "概要" });
      await expect(first).toHaveAttribute("aria-selected", "true");
      await expect(first).toHaveCSS("border-top-width", "0px");
      await expect(page.getByRole("tablist")).toHaveCSS("border-bottom-width", "1px");
      await page.keyboard.press("Tab");
      await first.focus();
      await expect(first).toHaveCSS("outline-style", "solid");
      await page.keyboard.press("ArrowRight");
      const second = page.getByRole("tab", { name: "詳細" });
      await expect(second).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("tabpanel", { name: "詳細" })).toBeVisible();
      const indicator = page.locator("[data-tab-indicator]");
      await expect(indicator).toHaveCSS("height", variant === "primary" ? "3px" : "2px");
      await expect(indicator).toBeVisible();
      const target = variant === "primary" ? second.locator("[data-tab-content]") : second;
      await expect
        .poll(async () =>
          Math.abs(
            ((await indicator.boundingBox())?.x ?? Infinity) -
              ((await target.boundingBox())?.x ?? 0),
          ),
        )
        .toBeLessThan(1);
      expect(await indicator.evaluate((el) => el.getAnimations().length)).toBe(0);
      await page.screenshot({ path: testInfo.outputPath(`tabs-${variant}-${colorScheme}.png`) });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }
    await page.goto("/iframe.html?id=shared-ui-tabs--scrollable&viewMode=story");
    const list = page.getByRole("tablist");
    expect(await list.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
});

test("すべてのストーリーを描画でき、StyleXのスタイルが適用される", async ({ page, request }) => {
  const response = await request.get("/index.json");
  expect(response.ok()).toBeTruthy();
  const index = (await response.json()) as {
    entries: Record<string, { id: string; type: string }>;
  };
  const stories = Object.values(index.entries).filter((entry) => entry.type === "story");
  expect(stories.length).toBeGreaterThan(0);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  for (const story of stories) {
    await test.step(story.id, async () => {
      await page.goto(`/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story`);
      const root = page.locator("#storybook-root");
      await expect(root).toBeVisible();
      await expect(root).not.toBeEmpty();
      await expect(root.locator(":scope > *").first()).toHaveAttribute("class", /\S+/);
      await expect(page.locator("body")).not.toContainText("Unexpected 'stylex.");
      expect(errors).toEqual([]);
    });
  }

  await page.goto("/iframe.html?id=shared-ui-badge--success&viewMode=story");
  await expect(page.locator("#storybook-root span")).toHaveCSS("display", "inline-flex");
});

test("ボタン比較に全バリアント・サイズ・無効状態があり、キーボードフォーカスを表示する", async ({
  page,
}) => {
  await page.goto("/iframe.html?id=shared-ui-button--variants&viewMode=story");
  const table = page.getByRole("table", { name: "ボタンのバリアントと状態の比較" });
  await expect(table).toBeVisible();
  for (const name of ["Elevated", "Filled", "Tonal", "Outlined", "Text"]) {
    await expect(table.getByRole("button", { name, exact: true })).toHaveCount(3);
    await expect(table.getByRole("button", { name, exact: true }).last()).toBeDisabled();
  }
  await page.keyboard.press("Tab");
  const button = table.getByRole("button", { name: "Filled", exact: true }).first();
  await button.focus();
  await expect(button).toHaveCSS("outline-style", "solid");
  await expect(button).toBeEnabled();
});
