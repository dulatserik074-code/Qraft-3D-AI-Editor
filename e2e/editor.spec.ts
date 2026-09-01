import { expect, test } from "@playwright/test";
test("guest can edit a persistent Three.js scene", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Куб" }).click();
  await expect(page.getByText("Куб 1")).toBeVisible();
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Canvas bounds unavailable");
  await page.mouse.click(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.getByLabel("position x").fill("2");
  await page.getByRole("button", { name: "Отменить" }).click();
  await page.getByRole("button", { name: "Повторить" }).click();
  await page.getByRole("button", { name: "Перспектива" }).click();
  await expect(page.getByText("Куб 1")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Куб 1")).toBeVisible();
});
test("mobile drawers expose editor controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: /Добавить/ }).click();
  await expect(page.getByRole("button", { name: "Куб" })).toBeVisible();
});
