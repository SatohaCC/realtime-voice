import { expect, test } from "@playwright/test";

test("ワークスペースは FHD で左右 50:50 に分割され、長い文字列でもはみ出さない", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(
    "/iframe.html?id=features-transcription-transcriptionworkspaceview--default&viewMode=story",
  );

  const transcriptPane = page.locator('[data-workspace-pane="transcript"]');
  const soapPane = page.locator('[data-workspace-pane="soap"]');

  await expect(transcriptPane).toBeVisible();
  await expect(soapPane).toBeVisible();

  const transcriptBox = await transcriptPane.boundingBox();
  const soapBox = await soapPane.boundingBox();
  expect(transcriptBox).not.toBeNull();
  expect(soapBox).not.toBeNull();
  if (transcriptBox && soapBox) {
    expect(Math.abs(transcriptBox.width - soapBox.width)).toBeLessThanOrEqual(2);
    expect(transcriptBox.x).toBeLessThan(soapBox.x);
  }

  const transcriptHeaderBox = await transcriptPane.locator("[data-pane-header]").boundingBox();
  const soapHeaderBox = await soapPane.locator("[data-pane-header]").boundingBox();
  expect(transcriptHeaderBox).not.toBeNull();
  expect(soapHeaderBox).not.toBeNull();
  if (transcriptHeaderBox && soapHeaderBox) {
    expect(Math.abs(transcriptHeaderBox.height - soapHeaderBox.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(transcriptHeaderBox.y - soapHeaderBox.y)).toBeLessThanOrEqual(1);
  }

  for (const key of ["S", "O", "A", "P"]) {
    await expect(soapPane.locator(`[data-soap-section="${key}"]`)).toBeVisible();
  }

  // 根拠クリックで対象発話が強調される
  await page.getByRole("button", { name: /根拠.*昨日から喉が痛くて/ }).click();
  await expect(transcriptPane.locator('[data-segment-key="s1:seg-2"]')).toHaveAttribute(
    "data-highlighted",
    "true",
  );

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("狭い画面とダークテーマでタブ切替・根拠ジャンプが動作し、横溢れしない", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    "/iframe.html?id=features-transcription-transcriptionworkspaceview--default&viewMode=story",
  );

  const soapTab = page.getByRole("tab", { name: /SOAP/ });
  const transcriptTab = page.getByRole("tab", { name: /文字起こし/ });

  await expect(soapTab).toBeVisible();
  await expect(transcriptTab).toHaveAttribute("aria-selected", "true");

  await soapTab.click();
  await expect(soapTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-workspace-pane="soap"]')).toBeVisible();

  // SOAP タブ内の根拠をクリックすると文字起こしタブへ戻り対象発話を強調する
  await page.getByRole("button", { name: /根拠.*37\.8℃/ }).click();
  await expect(transcriptTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-segment-key="s1:seg-2"]')).toHaveAttribute(
    "data-highlighted",
    "true",
  );

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("SegmentedControl は明暗テーマ・狭い幅・キーボード操作でインジケータが追従する", async ({
  page,
}) => {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto("/iframe.html?id=shared-ui-segmentedcontrol--default&viewMode=story");

    const group = page.getByRole("radiogroup", { name: "収音モード" });
    const dual = page.getByRole("radio", { name: "2マイク（話者分離）" });
    const single = page.getByRole("radio", { name: "1マイク" });
    const indicator = page.locator("[data-segmented-indicator]");

    await expect(group).toHaveCSS("border-top-width", "1px");
    await expect(dual).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Tab");
    await expect(dual).toHaveCSS("outline-style", "solid");

    await page.keyboard.press("ArrowRight");
    await expect(single).toHaveAttribute("aria-checked", "true");
    await expect
      .poll(async () =>
        Math.abs(
          ((await indicator.boundingBox())?.width ?? 0) -
            ((await single.boundingBox())?.width ?? Infinity),
        ),
      )
      .toBeLessThan(2);

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
});
