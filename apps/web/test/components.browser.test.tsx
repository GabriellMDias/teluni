import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";
import { createRef, type CSSProperties, type FormEvent } from "react";
import { Button, ErrorNotice, TextField } from "../src/components.js";
import { ApiFailure } from "../src/api-client.js";

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
