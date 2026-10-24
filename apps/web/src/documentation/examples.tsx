import { useState } from "react";
import { Button, ErrorNotice, TextField } from "../components.js";
import { ApiFailure } from "../api-client.js";

export function Example({ id }: { id: string }) {
  const [message, setMessage] = useState("");
  switch (id) {
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
