import { useState } from "react";
import {
  Button,
  Checkbox,
  DataGrid,
  DataSet,
  ErrorNotice,
  Menu,
  MultiSelectList,
  Popover,
  TextField,
} from "../components.js";
import type { DataGridColumn } from "../data-grid.js";
import type { DataSetMode } from "../dataset.js";
import { ApiFailure } from "../api-client.js";
import { UiIcon } from "../ui-icon.js";

type ExampleStore = { id: string; name: string; city: string; screens: number };

const exampleRecords: ExampleStore[] = [
  { id: "north", name: "North store", city: "Recife", screens: 4 },
  { id: "south", name: "South store", city: "Porto Alegre", screens: 2 },
  { id: "west", name: "West store", city: "Cuiabá", screens: 3 },
  { id: "east", name: "East store", city: "Recife", screens: 5 },
];

const exampleColumns: DataGridColumn<ExampleStore>[] = [
  { key: "name", header: "Name", value: (row) => row.name },
  { key: "city", header: "City", value: (row) => row.city },
  {
    key: "screens",
    header: "Screens",
    value: (row) => row.screens,
    align: "end",
    width: 140,
  },
];

function DataSetExample() {
  const [mode, setMode] = useState<DataSetMode>("grid");
  const [selected, setSelected] = useState("north");
  const record =
    exampleRecords.find((store) => store.id === selected) ?? exampleRecords[0];
  return (
    <div className="docs-preview">
      <DataSet
        label="Example stores"
        locale="en-US"
        mode={mode}
        rows={exampleRecords}
        columns={exampleColumns}
        rowId={(row) => row.id}
        selectedId={selected}
        onSelect={setSelected}
        onModeChange={setMode}
        exportName="Example stores"
      >
        <TextField
          key={record.id}
          label="Store name"
          defaultValue={record.name}
        />
      </DataSet>
    </div>
  );
}

type ExampleScreen = {
  id: string;
  name: string;
  city: string;
  online: boolean;
};

const exampleCities = ["Recife", "Porto Alegre", "Cuiabá", "Salvador", "Belém"];

const screenColumns: DataGridColumn<ExampleScreen>[] = [
  { key: "name", header: "Screen", value: (row) => row.name },
  { key: "city", header: "City", value: (row) => row.city },
  {
    key: "status",
    header: "Status",
    value: (row) => (row.online ? "Online" : "Offline"),
    width: 160,
  },
];

function DataGridExample() {
  const [rows] = useState(() =>
    Array.from({ length: 10_000 }, (_, index) => ({
      id: `screen-${index + 1}`,
      name: `Screen ${index + 1}`,
      city: exampleCities[index % exampleCities.length],
      online: index % 3 !== 0,
    })),
  );
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <div className="docs-preview">
      <DataGrid
        label="Example screens"
        locale="en-US"
        rows={rows}
        columns={screenColumns}
        rowId={(row) => row.id}
        multiple
        selectedIds={selected}
        onSelectedIdsChange={setSelected}
        exportName="Example screens"
      />
    </div>
  );
}

function MultiSelectListExample() {
  const [selected, setSelected] = useState(() => new Set(["Recife"]));
  return (
    <div className="docs-preview">
      <MultiSelectList
        label="Example cities"
        locale="en-US"
        options={exampleCities.map((city) => ({ value: city, label: city }))}
        selected={selected}
        onChange={setSelected}
        height={160}
      />
      <p role="status">{selected.size} chosen; no request was made.</p>
    </div>
  );
}

function PopoverExample() {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  return (
    <div className="docs-preview">
      <Button
        ref={setAnchor}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Show details
      </Button>
      <Popover
        anchor={anchor}
        open={open}
        onClose={() => setOpen(false)}
        label="Example details"
      >
        <p style={{ margin: "0.75rem" }}>Synthetic details; no request.</p>
      </Popover>
    </div>
  );
}

export function Example({ id }: { id: string }) {
  const [message, setMessage] = useState("");
  switch (id) {
    case "dataset-modes":
      return <DataSetExample />;
    case "data-grid-large":
      return <DataGridExample />;
    case "multi-select-list-search":
      return <MultiSelectListExample />;
    case "popover-anchored":
      return <PopoverExample />;
    case "menu-actions":
      return (
        <div className="docs-preview">
          <Menu
            label="Example actions"
            items={[
              {
                key: "rename",
                label: "Rename",
                onSelect: () => setMessage("Rename selected; no request."),
              },
              {
                key: "archive",
                label: "Archive",
                disabled: true,
                onSelect: () => undefined,
              },
            ]}
          >
            <UiIcon name="more" />
          </Menu>
          {message && <p role="status">{message}</p>}
        </div>
      );
    case "checkbox-states":
      return (
        <div className="docs-preview">
          <Checkbox label="Checked example" defaultChecked />{" "}
          <Checkbox label="Mixed example" indeterminate />{" "}
          <Checkbox label="Disabled example" disabled />
        </div>
      );
    case "button-states":
      return (
        <div className="docs-preview">
          <Button
            variant="primary"
            onClick={() =>
              setMessage("Demonstration action selected; no request was made.")
            }
          >
            Save example
          </Button>{" "}
          <Button disabled>Disabled action</Button>{" "}
          <Button pending>Saving example…</Button>
          <div className="docs-example-theme">
            <Button variant="primary">Product token override</Button>
          </div>
          {message && <p role="status">{message}</p>}
        </div>
      );
    case "text-field-states":
      return (
        <div className="docs-preview">
          <TextField
            label="Example name"
            hint="Only used inside this preview."
            required
          />
          <TextField
            label="Example email"
            type="email"
            error="Enter an email address."
          />
          <TextField
            label="Disabled example"
            disabled
            defaultValue="Synthetic value"
          />
        </div>
      );
    case "unavailable-reload":
      return (
        <div className="docs-preview">
          <ErrorNotice
            error={
              new ApiFailure(
                503,
                "SERVICE_UNAVAILABLE",
                "example",
                "The service is unavailable.",
              )
            }
            onReload={() =>
              setMessage("Demonstration reload selected; no request was made.")
            }
          />
          {message && <p role="status">{message}</p>}
        </div>
      );
    default:
      return null;
  }
}
