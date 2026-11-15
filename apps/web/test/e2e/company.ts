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

/** Center the map through local city search, then confirm a synthetic branch point. */
export async function selectBranchLocation(
  page: Page,
  query = "São Paulo BR",
  label = "São Paulo, São Paulo, Brasil",
) {
  await page
    .getByLabel("Endereço completo", { exact: true })
    .fill(`Rua de teste, 100, Centro, ${label}`);
  await page
    .getByLabel("Encontrar cidade no mapa", { exact: true })
    .fill(query);
  const map = page.getByRole("region", {
    name: "Mapa da localização da filial",
    exact: true,
  });
  await expect(map).toHaveClass(/leaflet-container/);
  await page
    .getByRole("list", { name: "Cidades encontradas" })
    .getByRole("button", { name: label, exact: true })
    .click();
  await map.focus();
  await map.press("Enter");
  await expect(
    page.getByText("Localização selecionada:", { exact: true }),
  ).toBeVisible();
}
