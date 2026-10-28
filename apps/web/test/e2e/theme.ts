import { expect, type Page } from "@playwright/test";

/** The sidebar's light/dark switch (Portuguese copy). */
export const themeSwitch = (page: Page) =>
  page.getByRole("switch", { name: "Tema escuro", exact: true });

/**
 * Selects a theme with the sidebar switch, opening and closing the narrow
 * screen menu when the switch is inside it.
 */
export async function chooseTheme(
  page: Page,
  theme: "light" | "dark",
): Promise<void> {
  const toggle = themeSwitch(page);
  const opened = !(await toggle.isVisible());
  if (opened)
    await page.getByRole("button", { name: "Menu", exact: true }).click();
  const checked = String(theme === "dark");
  if ((await toggle.getAttribute("aria-checked")) !== checked)
    await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", checked);
  if (opened) await page.keyboard.press("Escape");
}
