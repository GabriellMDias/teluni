import { expect, type Page } from "@playwright/test";

// A new company's empty branches dataset pins its form in the URL. Keep that
// state out of the base URL used to navigate to other company workflows.
export async function waitForCreatedCompany(page: Page): Promise<string> {
  await expect(page).toHaveURL(
    (url) =>
      /^\/companies\/[0-9a-f-]{36}$/.test(url.pathname) &&
      url.searchParams.get("mode") === "form" &&
      url.searchParams.get("record") === "new",
    { timeout: 20_000 },
  );
  const url = new URL(page.url());
  return `${url.origin}${url.pathname}`;
}
