# Web Component Reference

<!-- Generated from owned components.docs.json files and verified against named component exports. Do not edit. -->

[Component architecture](../../architecture/web-components.md) · [Living documentation](../../architecture/living-documentation.md)

## Button

A native action button with explicit variants and safe pending behavior.

Category: Actions. Scope: shared. Owner: Web UI.

Source: [apps/web/src/components.tsx](../../../apps/web/src/components.tsx) (export `Button`). Metadata: [apps/web/src/components.docs.json](../../../apps/web/src/components.docs.json).

### Props

| Name | Type | Meaning | Required | Default |
| --- | --- | --- | --- | --- |
| `children` | `ReactNode` | Visible action name or content with an equivalent accessible name. | Yes | — |
| `type` | `button \| submit \| reset` | Native form behavior; the safe default does not submit a form. | No | button |
| `variant` | `primary \| secondary` | Semantic action emphasis, styled through product-owned tokens. | No | secondary |
| `pending` | `boolean` | Disables activation and exposes aria-busy while the caller owns pending work. | No | false |
| `…buttonProps` | `ComponentPropsWithRef<"button">` | Native props such as disabled, onClick, className, ref and ARIA attributes are forwarded. | See type | — |

### States

- Default and primary
- Hover and keyboard focus
- Disabled
- Pending
- Product token override

Accessibility: Uses a native button and visible focus. Pending disables activation and sets aria-busy; preserve meaningful button text while work is pending.

Usage: Use for actions. Use a link for navigation. Keep a visible accessible name; choose type=submit explicitly inside forms. Native button props and refs are forwarded.

### Examples

- **Action states and product styling** (`button-states`): Local actions, disabled and pending states, and a scoped token override.

```tsx
<Button variant="primary" onClick={save}>Save</Button>
<Button pending>Saving…</Button>
```


## TextField

A labeled native input with linked hints and validation messages.

Category: Inputs. Scope: composed. Owner: Web UI.

Source: [apps/web/src/components.tsx](../../../apps/web/src/components.tsx) (export `TextField`). Metadata: [apps/web/src/components.docs.json](../../../apps/web/src/components.docs.json).

### Props

| Name | Type | Meaning | Required | Default |
| --- | --- | --- | --- | --- |
| `type` | `Text-entry native input types` | Supports text, email, password, search, tel, url, number and native date/time inputs. Use separate native controls for checkbox, radio, file, range or other selection behavior. | No | text |
| `label` | `string` | Persistent accessible label; a placeholder cannot replace it. | Yes | — |
| `id` | `string` | Optional DOM id; a stable useId value is generated when absent. | No | Generated with useId |
| `hint` | `string` | Optional help linked to the input through aria-describedby. | No | — |
| `error` | `string` | Caller-owned validation message linked to the input; also marks it invalid. | No | — |
| `…inputProps` | `ComponentPropsWithRef<"input">` | Native value/defaultValue, onChange, type, required, disabled, className, ref and ARIA props are forwarded. Existing aria-describedby references are retained. | See type | — |

### States

- Empty and populated
- Hint
- Validation error
- Required
- Disabled
- Keyboard focus

Accessibility: Associates label and input through a stable id; links hint and error descriptions and sets aria-invalid for errors. Native required, disabled, ref and keyboard behavior are preserved. The feature owns dynamic error summaries or announcements.

Usage: Use for a single native input with a persistent label. The caller owns value, validation and submission. Keep domain-specific validation and credentials in the feature; use other native controls for multiline text or selection.

### Examples

- **Labeled input and validation** (`text-field-states`): Synthetic form input with a hint, validation message and disabled state.

```tsx
<TextField label="Name" hint="Shown to your colleagues." required />
<TextField label="Email" type="email" error="Enter an email address." />
```


## ErrorNotice

Displays a public API failure message and an optional reload action.

Category: Feedback. Scope: composed. Owner: Web UI.

Source: [apps/web/src/components.tsx](../../../apps/web/src/components.tsx) (export `ErrorNotice`). Metadata: [apps/web/src/components.docs.json](../../../apps/web/src/components.docs.json).

### Props

| Name | Type | Meaning | Required | Default |
| --- | --- | --- | --- | --- |
| `error` | `unknown` | Mapped through the shared public failure-message boundary. | See type | — |
| `operation` | `read \| create \| write` | Selects the failure wording; failed or lost writes are reported as unknown outcomes. Defaults to read. | See type | — |
| `messages` | `Record<string, string> (optional)` | Module-specific wording for its own stable error codes. | See type | — |
| `onReload` | `() => void` | Optional recovery action when current data can be refreshed. | See type | — |
| `reloadLabel` | `string (optional)` | Accessible name of the reload action; defaults to Reload. | See type | — |

### States

- Failure message
- Failure message with reload action

Accessibility: Uses role=alert so the failure is announced; the optional reload control is a native button.

Usage: Pass the original error to preserve stable-code mapping. Offer reload only when the current data can be refreshed, and never imply that an unknown write outcome failed.

### Examples

- **Unavailable service with reload** (`unavailable-reload`): A synthetic SERVICE_UNAVAILABLE response; no live request is involved.
