import { expect, test } from "@playwright/test";

test("Cardは明暗テーマで3種類の区切り方を持ち、SOAP項目は枠線なしになる", async ({ page }) => {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    for (const variant of ["filled", "outlined", "elevated"]) {
      await page.goto(`/iframe.html?id=shared-ui-card--${variant}&viewMode=story`);
      const card = page.getByText(
        "関連する内容をまとめるカードです。背景色・枠線・影で区切り方を選びます。",
      );
      await expect(card).toBeVisible();
      await expect(card).toHaveCSS("border-left-width", variant === "outlined" ? "1px" : "0px");
      if (variant === "elevated") {
        await expect(card).not.toHaveCSS("box-shadow", "none");
      } else {
        await expect(card).toHaveCSS("box-shadow", "none");
      }
    }

    await page.goto("/iframe.html?id=shared-components-soappanel--default&viewMode=story");
    const item = page.locator("[data-soap-item-id]").first();
    await expect(item).toBeVisible();
    for (const side of ["left", "right", "top", "bottom"]) {
      await expect(item).toHaveCSS(`border-${side}-width`, "0px");
    }
    await expect(item).toHaveCSS("box-shadow", "none");
    await page.screenshot({ path: `../.cache/card-soap-${colorScheme}.png`, fullPage: true });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
});

test("Card内の操作はキーボードでフォーカスでき、カード自体はフォーカスしない", async ({ page }) => {
  await page.goto("/iframe.html?id=shared-ui-card--with-actions&viewMode=story");
  const card = page.getByRole("article", { name: "カードのタイトル" });
  await expect(card).toBeVisible();
  await expect(card).not.toHaveAttribute("tabindex");
  await page.getByRole("button", { name: "詳細を見る" }).focus();
  await expect(page.getByRole("button", { name: "詳細を見る" })).toBeFocused();
});
