import { useState } from "react";
import { Button, DataSet, ErrorNotice, TextField } from "../components.js";
import type { DataSetMode } from "../dataset.js";
import { ApiFailure } from "../api-client.js";

const exampleRecords = [
  { id: "north", name: "North store", city: "Recife" },
  { id: "south", name: "South store", city: "Porto Alegre" },
  { id: "west", name: "West store", city: "Cuiabá" },
];

function DataSetExample() {
  const [mode, setMode] = useState<DataSetMode>("grid");
  const [selected, setSelected] = useState("north");
  const index = exampleRecords.findIndex((record) => record.id === selected);
  const record = exampleRecords[index];
  return (
    <div className="docs-preview">
      <DataSet
        label="Example stores"
        locale="en-US"
        mode={mode}
        rows={exampleRecords}
        columns={[
          { key: "name", header: "Name", render: (row) => row.name },
          { key: "city", header: "City", render: (row) => row.city },
        ]}
        rowId={(row) => row.id}
        rowName={(row) => row.name}
        selectedId={selected}
        onSelect={setSelected}
        onModeChange={setMode}
        onPrevious={
          index > 0
            ? () => setSelected(exampleRecords[index - 1].id)
            : undefined
        }
        onNext={
          index < exampleRecords.length - 1
            ? () => setSelected(exampleRecords[index + 1].id)
            : undefined
        }
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

export function Example({ id }: { id: string }) {
  const [message, setMessage] = useState("");
  switch (id) {
    case "dataset-modes":
      return <DataSetExample />;
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
