import { expect, test } from "@playwright/test";

test("ヘッダーは狭い幅でも収まり、メニューの次にリンクへTab移動できる", async ({ page }) => {
  for (const width of [320, 390, 600, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/iframe.html?id=shared-components-header--default&viewMode=story");
    await expect(page.getByRole("banner")).toHaveCSS("border-bottom-width", "1px");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (width < 840) {
      const menu = page.getByRole("button", { name: "メニュー" });
      await menu.click();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: "概要" })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(menu).toBeFocused();
      await expect(menu).toHaveAttribute("aria-expanded", "false");
    }
  }
});

test("セレクトと音声パネルに指定した枠線が適用される", async ({ page }) => {
  await page.goto("/iframe.html?id=shared-ui-select--default&viewMode=story");
  const trigger = page.getByRole("combobox");
  await expect(trigger).toHaveCSS("border-top-width", "1px");
  await expect(trigger).toHaveCSS("border-top-style", "solid");
  await trigger.click();
  await expect(page.getByRole("listbox")).toHaveCSS("border-top-width", "1px");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(trigger).toContainText("Speaker B");
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/iframe.html?id=shared-components-dualmicpanel--single-idle&viewMode=story");
  await expect(page.getByRole("radiogroup")).toHaveCSS("border-top-width", "1px");
  await expect(page.getByRole("combobox")).toHaveCSS("border-top-width", "1px");
  // 実ページのカード内と同程度の幅でも、列の最小幅が親を押し広げない。
  await page.locator("#storybook-root").evaluate((root) => {
    root.style.maxWidth = "232px";
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("アイコン・バッジ付きタブが伸縮して移動し、リサイズ・RTLにも追従する", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/iframe.html?id=shared-ui-tabs--with-icons-and-badges&viewMode=story");
  const first = page.getByRole("tab", { name: "概要 未読3件" });
  const second = page.getByRole("tab", { name: "詳細" });
  await expect(first).toHaveCSS("min-height", "72px");
  const indicator = page.locator("[data-tab-indicator]");
  await expect(indicator).toBeVisible();
  await second.click();
  const frameCount = await indicator.evaluate(
    (el) =>
      el.getAnimations().flatMap((animation) => (animation.effect as KeyframeEffect).getKeyframes())
        .length,
  );
  expect(frameCount).toBeGreaterThanOrEqual(17);
  await indicator.evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((animation) => animation.finished));
  });
  for (const direction of ["ltr", "rtl"]) {
    await page.evaluate((dir) => {
      document.documentElement.dir = dir;
    }, direction);
    await page.setViewportSize({ width: 390, height: 640 });
    await first.click();
    await second.click();
    await indicator.evaluate(async (el) => {
      await Promise.all(el.getAnimations().map((animation) => animation.finished));
    });
    const content = second.locator("[data-tab-content]");
    await expect
      .poll(async () =>
        Math.abs(
          ((await indicator.boundingBox())?.x ?? Infinity) -
            ((await content.boundingBox())?.x ?? 0),
        ),
      )
      .toBeLessThan(1);
  }
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await first.click();
  expect(await indicator.evaluate((el) => el.getAnimations().length)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("tabs-icons-badges-dark.png") });
});
