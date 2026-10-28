import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";
import { createRef, useState, type CSSProperties, type FormEvent } from "react";
import {
  Button,
  Checkbox,
  DataGrid,
  DataSet,
  ErrorNotice,
  MultiSelectList,
  TextField,
} from "../src/components.js";
import { ApiFailure } from "../src/api-client.js";
import type { DataGridColumn } from "../src/data-grid.js";
import type { DataSetMode } from "../src/dataset.js";

test("a failure exposes an accessible reload action", async () => {
  const reload = vi.fn();
  const screen = await render(
    <ErrorNotice
      error={new ApiFailure(409, "EXAMPLE_CONFLICT", "test-request", "Changed")}
      messages={{ EXAMPLE_CONFLICT: "This item changed. Reload it first." }}
      reloadLabel="Reload current item"
      onReload={reload}
    />,
  );
  await expect.element(screen.getByRole("alert")).toBeVisible();
  await expect
    .element(screen.getByText("This item changed. Reload it first."))
    .toBeVisible();
  await screen.getByRole("button", { name: "Reload current item" }).click();
  expect(reload).toHaveBeenCalledOnce();
});

test("buttons preserve native form and keyboard semantics and block pending activation", async () => {
  const submit = vi.fn((event: FormEvent) => event.preventDefault());
  const action = vi.fn();
  const screen = await render(
    <form onSubmit={submit}>
      <Button onClick={action}>Local action</Button>
      <Button type="submit">Submit form</Button>
      <Button pending onClick={action}>
        Pending action
      </Button>
      <Button disabled>Disabled action</Button>
    </form>,
  );
  await screen.getByRole("button", { name: "Local action" }).click();
  await userEvent.keyboard("{Enter}");
  expect(action).toHaveBeenCalledTimes(2);
  expect(submit).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: "Submit form" }).click();
  expect(submit).toHaveBeenCalledOnce();
  await expect
    .element(screen.getByRole("button", { name: "Pending action" }))
    .toBeDisabled();
  await expect
    .element(screen.getByRole("button", { name: "Pending action" }))
    .toHaveAttribute("aria-busy", "true");
  await expect
    .element(screen.getByRole("button", { name: "Disabled action" }))
    .toBeDisabled();
});

test("text fields associate labels, hints and errors, preserve refs and keep values caller-owned", async () => {
  const first = createRef<HTMLInputElement>();
  const second = createRef<HTMLInputElement>();
  const screen = await render(
    <>
      <p id="external-guidance">External guidance.</p>
      <TextField
        label="Display name"
        hint="Internal guidance."
        error="Name is required."
        aria-describedby="external-guidance"
        required
        ref={first}
      />
      <TextField label="Disabled name" disabled ref={second} />
    </>,
  );
  const field = screen.getByRole("textbox", { name: "Display name" });
  await expect.element(field).toBeRequired();
  await expect.element(field).toHaveAttribute("aria-invalid", "true");
  await expect
    .element(field)
    .toHaveAccessibleDescription(
      "External guidance. Internal guidance. Name is required.",
    );
  expect(first.current?.id).toBeTruthy();
  expect(first.current?.id).not.toBe(second.current?.id);
  await field.fill("Ada");
  await expect.element(field).toHaveValue("Ada");
  await expect
    .element(screen.getByRole("textbox", { name: "Disabled name" }))
    .toBeDisabled();
});

test("product tokens override reference typography, spacing and color without leaking outside the theme", async () => {
  const screen = await render(
    <>
      <div
        style={
          {
            "--ui-color-action": "#254e46",
            "--ui-font-size": "1.125rem",
            "--ui-space-4": "2rem",
          } as CSSProperties
        }
      >
        <Button variant="primary">Themed action</Button>
      </div>
      <Button variant="primary">Default action</Button>
    </>,
  );
  await expect
    .element(screen.getByRole("button", { name: "Themed action" }))
    .toHaveStyle({
      backgroundColor: "rgb(37, 78, 70)",
      fontSize: "18px",
      paddingLeft: "32px",
    });
  await expect
    .element(screen.getByRole("button", { name: "Default action" }))
    .toHaveStyle({ backgroundColor: "rgb(24, 95, 155)" });
});

test("an unknown write outcome is never presented as a known failure", async () => {
  const screen = await render(
    <ErrorNotice error={new TypeError("disconnect")} operation="write" />,
  );
  await expect
    .element(screen.getByText(/Update outcome is unknown/))
    .toBeVisible();
  await expect.element(screen.getByRole("button")).not.toBeInTheDocument();
});

test("a checkbox forwards native state and keeps the caller's mixed state", async () => {
  const change = vi.fn();
  const ref = createRef<HTMLInputElement>();
  const checkboxes = () => (
    <>
      <Checkbox label="Select all" indeterminate onChange={change} ref={ref} />
      <Checkbox label="Unavailable" disabled />
    </>
  );
  const screen = await render(checkboxes());
  const box = screen.getByRole("checkbox", { name: "Select all" });
  await expect.element(box).toBePartiallyChecked();
  // The browser clears the mixed state on activation; the prop restores it.
  await box.click();
  expect(change).toHaveBeenCalledOnce();
  await expect.element(box).toBePartiallyChecked();
  await screen.getByText("Select all").click();
  await screen.rerender(checkboxes());
  await expect.element(box).toBePartiallyChecked();
  expect(ref.current?.type).toBe("checkbox");
  await expect
    .element(screen.getByRole("checkbox", { name: "Unavailable" }))
    .toBeDisabled();
});

test("a multi-select list searches without accents, selects found options and toggles from the keyboard", async () => {
  const change = vi.fn();
  const options = ["Cuiabá", "Recife", "Salvador"].map((city) => ({
    value: city,
    label: city,
  }));
  const screen = await render(
    <MultiSelectList
      label="Cities"
      locale="en-US"
      options={options}
      selected={new Set(["Recife"])}
      onChange={change}
    />,
  );
  const search = screen.getByRole("searchbox", { name: "Search" });
  await expect
    .element(screen.getByRole("checkbox", { name: "Select all" }))
    .toBePartiallyChecked();
  await expect
    .element(screen.getByRole("option", { name: "Recife" }))
    .toHaveAttribute("aria-selected", "true");
  await search.fill("cuiaba");
  await expect.element(screen.getByRole("option")).toHaveTextContent("Cuiabá");
  await screen.getByRole("checkbox", { name: "Select all results" }).click();
  expect(change).toHaveBeenLastCalledWith(new Set(["Recife", "Cuiabá"]));
  await search.fill("");
  await userEvent.keyboard("{ArrowDown}");
  await expect
    .element(screen.getByRole("listbox", { name: "Cities" }))
    .toHaveFocus();
  await userEvent.keyboard("{ArrowDown}{ }");
  expect(change).toHaveBeenLastCalledWith(new Set());
  await search.fill("Manaus");
  await expect.element(screen.getByText("No values found.")).toBeVisible();
  await expect
    .element(screen.getByRole("checkbox", { name: "Select all results" }))
    .toBeDisabled();
});

type Store = { id: string; name: string; city: string };

const stores: Store[] = [
  { id: "a", name: "Beta store", city: "Recife" },
  { id: "b", name: "Alpha store", city: "Cuiabá" },
  { id: "c", name: "Gamma store", city: "Recife" },
];

const storeColumns: DataGridColumn<Store>[] = [
  { key: "name", header: "Name", value: (row) => row.name },
  { key: "city", header: "City", value: (row) => row.city },
];

const shownNames = (container: HTMLElement) =>
  [...container.querySelectorAll("tbody tr")].map(
    (row) => row.querySelector("td")?.textContent,
  );

test("a dataset selects rows by color only, switches modes and disables omitted actions", async () => {
  const select = vi.fn();
  const changeMode = vi.fn();
  const add = vi.fn();
  const props = {
    label: "Example records",
    locale: "en-US",
    rows: stores,
    columns: storeColumns,
    rowId: (row: Store) => row.id,
    selectedId: "a",
    onSelect: select,
    onModeChange: changeMode,
    onAdd: add,
  } as const;
  const screen = await render(
    <DataSet {...props} mode="grid">
      <p>Form content</p>
    </DataSet>,
  );
  const toolbar = screen.getByRole("toolbar", { name: "Record actions" });
  await expect
    .element(screen.getByRole("grid", { name: "Example records" }))
    .not.toHaveAttribute("aria-multiselectable");
  await expect.element(screen.getByRole("radio")).not.toBeInTheDocument();
  // Exports are offered only where a screen passes exportName.
  await expect
    .element(toolbar.getByRole("button", { name: "Export" }))
    .not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("row", { name: /Beta store/ }))
    .toHaveAttribute("aria-selected", "true");
  await screen.getByRole("gridcell", { name: "Gamma store" }).click();
  expect(select).toHaveBeenLastCalledWith("c");
  await screen.getByRole("gridcell", { name: "Alpha store" }).dblClick();
  expect(select).toHaveBeenLastCalledWith("b");
  expect(changeMode).toHaveBeenLastCalledWith("form");
  await toolbar.getByRole("button", { name: "Add" }).click();
  expect(add).toHaveBeenCalledOnce();
  for (const name of ["Previous record", "Duplicate", "Refresh"])
    await expect.element(toolbar.getByRole("button", { name })).toBeDisabled();
  await toolbar.getByRole("button", { name: "Next record" }).click();
  expect(select).toHaveBeenLastCalledWith("b");
  await expect
    .element(toolbar.getByRole("button", { name: "Delete" }))
    .not.toBeInTheDocument();
  await expect
    .element(screen.getByText("Form content"))
    .not.toBeInTheDocument();

  await screen.rerender(
    <DataSet {...props} mode="form" onDelete={null}>
      <p>Form content</p>
    </DataSet>,
  );
  await expect.element(screen.getByText("Form content")).toBeVisible();
  await expect.element(screen.getByRole("grid")).not.toBeInTheDocument();
  await expect
    .element(toolbar.getByRole("button", { name: "Delete" }))
    .toBeDisabled();
  await toolbar.getByRole("button", { name: "Grid mode" }).click();
  expect(changeMode).toHaveBeenLastCalledWith("grid");
});

function StoreDataSet() {
  const [mode, setMode] = useState<DataSetMode>("grid");
  const [selected, setSelected] = useState("a");
  return (
    <DataSet
      label="Stores"
      locale="en-US"
      mode={mode}
      rows={stores}
      columns={storeColumns}
      rowId={(row) => row.id}
      selectedId={selected}
      onSelect={setSelected}
      onModeChange={setMode}
    >
      <p>Editing {selected}</p>
    </DataSet>
  );
}

test("a dataset moves in the order the grid shows and keeps it across modes", async () => {
  const screen = await render(<StoreDataSet />);
  const toolbar = screen.getByRole("toolbar", { name: "Record actions" });
  const name = screen.getByRole("columnheader", { name: "Name" });
  await name.getByRole("button", { name: "Name" }).click();
  await expect.element(name).toHaveAttribute("aria-sort", "ascending");
  expect(shownNames(screen.container)).toEqual([
    "Alpha store",
    "Beta store",
    "Gamma store",
  ]);
  await toolbar.getByRole("button", { name: "Form mode" }).click();
  await expect.element(screen.getByText("Editing a")).toBeVisible();
  await toolbar.getByRole("button", { name: "Previous record" }).click();
  await expect.element(screen.getByText("Editing b")).toBeVisible();
  await expect
    .element(toolbar.getByRole("button", { name: "Previous record" }))
    .toBeDisabled();
  await toolbar.getByRole("button", { name: "Next record" }).click();
  await toolbar.getByRole("button", { name: "Next record" }).click();
  await expect.element(screen.getByText("Editing c")).toBeVisible();
  await expect
    .element(toolbar.getByRole("button", { name: "Next record" }))
    .toBeDisabled();
  await toolbar.getByRole("button", { name: "Grid mode" }).click();
  await expect
    .element(screen.getByRole("columnheader", { name: "Name" }))
    .toHaveAttribute("aria-sort", "ascending");
  await expect
    .element(screen.getByRole("row", { name: /Gamma store/ }))
    .toHaveAttribute("aria-selected", "true");
});

test("a grid sorts from headers and menus, and resizes columns from the keyboard", async () => {
  const screen = await render(
    <DataGrid
      label="Stores"
      locale="en-US"
      rows={stores}
      columns={storeColumns}
      rowId={(row) => row.id}
    />,
  );
  const name = screen.getByRole("columnheader", { name: "Name" });
  const sort = name.getByRole("button", { name: "Name" });
  await sort.click();
  await expect.element(name).toHaveAttribute("aria-sort", "ascending");
  await sort.click();
  await expect.element(name).toHaveAttribute("aria-sort", "descending");
  expect(shownNames(screen.container)[0]).toBe("Gamma store");
  await sort.click();
  await expect.element(name).not.toHaveAttribute("aria-sort");
  expect(shownNames(screen.container)[0]).toBe("Beta store");

  const options = screen.getByRole("button", { name: "Name column options" });
  await options.click();
  const menu = screen.getByRole("menu", { name: "Name column options" });
  await expect
    .element(menu.getByRole("menuitemcheckbox", { name: "Sort Ascending" }))
    .toHaveFocus();
  await menu.getByRole("menuitemcheckbox", { name: "Sort Descending" }).click();
  await expect.element(name).toHaveAttribute("aria-sort", "descending");
  await expect.element(options).toHaveFocus();
  await userEvent.keyboard("{ArrowUp}");
  await expect
    .element(menu.getByRole("menuitem", { name: "Filter" }))
    .toHaveFocus();
  await userEvent.keyboard("{Home}");
  await expect
    .element(menu.getByRole("menuitemcheckbox", { name: "Sort Descending" }))
    .toHaveAttribute("aria-checked", "true");
  await userEvent.keyboard("{Escape}");
  await expect.element(menu).not.toBeInTheDocument();
  await expect.element(options).toHaveFocus();

  const width = screen.getByRole("separator", { name: "Name column width" });
  await expect.element(width).toHaveAttribute("aria-valuenow", "200");
  (width.element() as HTMLElement).focus();
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(width).toHaveAttribute("aria-valuenow", "216");
  expect((name.element() as HTMLElement).getBoundingClientRect().width).toBe(
    216,
  );
});

test("a grid filters by a column's values and recovers when no row matches", async () => {
  const props = {
    label: "Stores",
    locale: "en-US",
    columns: storeColumns,
    rowId: (row: Store) => row.id,
  } as const;
  const screen = await render(<DataGrid {...props} rows={stores} />);
  const options = screen.getByRole("button", { name: "City column options" });
  await options.click();
  await screen.getByRole("menuitem", { name: "Filter" }).click();
  const dialog = screen.getByRole("dialog", { name: "Filter City" });
  const search = dialog.getByRole("searchbox", { name: "Search" });
  await expect.element(search).toHaveFocus();
  await expect
    .element(
      dialog
        .getByRole("listbox", { name: "City values" })
        .getByRole("option", { name: "Cuiabá" }),
    )
    .toHaveAttribute("aria-selected", "true");
  await expect
    .element(dialog.getByRole("checkbox", { name: "Select all" }))
    .toBeChecked();
  // A search keeps only the chosen values it found.
  await search.fill("cuiaba");
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect.element(dialog).not.toBeInTheDocument();
  await expect.element(options).toHaveFocus();
  await expect.element(options).toHaveAttribute("data-filtered", "true");
  expect(shownNames(screen.container)).toEqual(["Alpha store"]);
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("1 of 3 records");

  await options.click();
  await screen.getByRole("menuitem", { name: "Filter" }).click();
  await expect
    .element(screen.getByRole("checkbox", { name: "Select all" }))
    .toBePartiallyChecked();
  await screen.getByRole("option", { name: "Cuiabá" }).click();
  await expect
    .element(screen.getByRole("button", { name: "Apply" }))
    .toBeDisabled();
  await screen.getByRole("button", { name: "Cancel" }).click();
  expect(shownNames(screen.container)).toEqual(["Alpha store"]);

  await screen.rerender(
    <DataGrid {...props} rows={stores.filter((row) => row.id !== "b")} />,
  );
  await expect
    .element(screen.getByText("No records match the filters."))
    .toBeVisible();
  await screen.getByRole("button", { name: "Clear filters" }).click();
  expect(shownNames(screen.container)).toEqual(["Beta store", "Gamma store"]);
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("2 records");
});

function ManyScreens() {
  const [rows] = useState(() =>
    Array.from({ length: 5_000 }, (_, index) => ({
      id: `screen-${index}`,
      name: `Screen ${index}`,
    })),
  );
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <DataGrid
      label="Screens"
      locale="pt-BR"
      rows={rows}
      columns={[{ key: "name", header: "Nome", value: (row) => row.name }]}
      rowId={(row) => row.id}
      multiple
      selectedIds={selected}
      onSelectedIdsChange={setSelected}
    />
  );
}

test("a grid renders only the rows in view and selects several rows", async () => {
  const screen = await render(<ManyScreens />);
  const grid = screen.getByRole("grid", { name: "Screens" });
  await expect.element(grid).toHaveAttribute("aria-rowcount", "5001");
  await expect.element(grid).toHaveAttribute("aria-multiselectable", "true");
  expect(screen.container.querySelectorAll("tbody tr").length).toBeLessThan(60);
  const status = screen.getByRole("status");
  await expect.element(status).toHaveTextContent("5.000 registros");
  const cell = (name: string) =>
    screen.getByRole("gridcell", { name, exact: true });
  await cell("Screen 0").click();
  await cell("Screen 2").click({ modifiers: ["Shift"] });
  await expect
    .element(status)
    .toHaveTextContent("5.000 registros · 3 selecionados");
  await cell("Screen 1").click({ modifiers: ["ControlOrMeta"] });
  await expect
    .element(status)
    .toHaveTextContent("5.000 registros · 2 selecionados");
  await expect
    .element(screen.getByRole("row", { name: "Screen 1", exact: true }))
    .toHaveAttribute("aria-selected", "false");
  await userEvent.keyboard("{End}");
  const last = screen.getByRole("row", { name: "Screen 4999", exact: true });
  await expect.element(last).toHaveFocus();
  await expect.element(last).toHaveAttribute("aria-rowindex", "5001");
  await expect
    .element(status)
    .toHaveTextContent("5.000 registros · 1 selecionado");
  await userEvent.keyboard("{Control>}a{/Control}");
  await expect
    .element(status)
    .toHaveTextContent("5.000 registros · 5.000 selecionados");
});

test("a dataset exports the rows it shows to Excel, CSV and PDF", async () => {
  const downloads: { name: string; href: string }[] = [];
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push({ name: this.download, href: this.href });
    });
  try {
    const columns: DataGridColumn<Store>[] = [
      ...storeColumns,
      // Columns without a value are left out of exports.
      { key: "open", header: "Open", render: () => <a href="#store">Open</a> },
    ];
    const screen = await render(
      <DataSet
        label="Stores"
        locale="pt-BR"
        mode="grid"
        rows={stores}
        columns={columns}
        rowId={(row) => row.id}
        exportName="Lojas"
      />,
    );
    const name = screen.getByRole("columnheader", { name: "Name" });
    await name.getByRole("button", { name: "Name" }).click();
    const download = async (format: string) => {
      await screen.getByRole("button", { name: "Exportar" }).click();
      await screen
        .getByRole("menu", { name: "Exportar" })
        .getByRole("menuitem", { name: format })
        .click();
      await expect.poll(() => downloads.length).toBeGreaterThan(0);
      const { name: file, href } = downloads.pop()!;
      return { file, blob: await (await fetch(href)).blob() };
    };

    const csv = await download("CSV (.csv)");
    expect(csv.file).toMatch(/^Lojas \d{4}-\d{2}-\d{2}\.csv$/);
    expect(await csv.blob.text()).toBe(
      "Name;City\r\nAlpha store;Cuiabá\r\nBeta store;Recife\r\nGamma store;Recife\r\n",
    );
    const xlsx = await download("Excel (.xlsx)");
    expect(xlsx.file).toMatch(/\.xlsx$/);
    expect(xlsx.blob.type).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    const pdf = await download("PDF (.pdf)");
    expect(pdf.file).toMatch(/\.pdf$/);
    expect(await pdf.blob.slice(0, 5).text()).toBe("%PDF-");
    await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
  } finally {
    click.mockRestore();
  }
});

test("a dataset shows the caller's empty state and pending refresh", async () => {
  const screen = await render(
    <DataSet
      label="Empty records"
      locale="pt-BR"
      mode="grid"
      rows={[]}
      columns={[]}
      rowId={() => ""}
      onRefresh={() => undefined}
      refreshing
      empty={<p>Nothing yet.</p>}
    />,
  );
  await expect.element(screen.getByText("Nothing yet.")).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Atualizar" }))
    .toHaveAttribute("aria-busy", "true");
  await expect
    .element(screen.getByRole("button", { name: "Atualizar" }))
    .toBeDisabled();
});
