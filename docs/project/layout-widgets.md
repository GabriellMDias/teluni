# Layout Information Components

[Composition design](catalog-composition-design.md) · [Player design](player-design.md) · [ADR-0037](../adr/0037-publish-widget-configuration-and-proxy-live-public-data.md)

## Authoring and publication

The Programming layout editor offers Media, Catalog, Clock/date, Dynamic QR, Scrolling text, Weather and RSS news. All retain the existing rectangle/stacking model, click/drag insertion, keyboard/numeric geometry, partitions, history, expected-version saves and guarded recovery. Widget controls reuse Button, TextField and existing branch choices; the layout overview remains DataSet. The canvas is illustrative. Explicit QR/weather/RSS previews use the authenticated API; unavailable sources do not discard the draft. Clock previews show the browser's time, while playback follows each screen's configured location.

A widget is `kind: "widget"` with a version 1 `widget` configuration. Common properties are `locale` (`pt-BR`/`en-US`), `textSize` (24–200 canvas units) and `foreground` (`#RRGGBB`). Existing area background and geometry still apply. QR areas require at least 240 × 240 canvas units to retain a usable code and quiet zone. Widgets are muted at volume zero and cannot participate in coordinated layout pages. Their output defaults to their configured presentation (`{ "view": true }`); an active regional playlist rule can override it. Switching an existing playlist default to a widget follows the same explicit default-removal confirmation as a catalog area.

| Type | Configuration | Playback |
| --- | --- | --- |
| `clock` | Time/date visibility, optional seconds, 12/24-hour clock and short/full date | Uses trusted time and server-provided screen zone offsets; never the device's time-zone database. |
| `qr` | Public HTTPS destination and caption | A server-generated, error-correction M matrix with a four-module quiet zone, rendered natively. |
| `ticker` | Plain text up to 2,000 code points and speed 20–160 canvas units/second | Continuous native animation based on monotonic elapsed time. |
| `weather` | Coordinates rounded to four decimal places, location label and Celsius/Fahrenheit; the editor can copy a registered branch's location | Forecast temperature/condition and MET Norway credit; explicit stale/unavailable states. |
| `rss` | Public HTTPS RSS 2.0/Atom feed, section title, 5–120 seconds per headline and up to 20 items | Plain-text headlines cycle by trusted epoch; source credit and item position remain visible. Article HTML/images are never loaded. |

Saving changes only the layout draft. Publishing takes the immutable widget configuration with the layout snapshot. Layout JSON containing widgets uses `teluni.layout` schema 2; non-widget exports remain schema 1, and imports of both versions are supported. Schema 1 cannot carry widgets.

## Dynamic QR lifecycle

The opaque link identity is the first 128 bits of SHA-256 over `teluni.qr.v1:<lowercase layout UUID>:<area key>`. Its encoded address is `/q/<identity>` at the configured `TELUNI_PUBLIC_ORIGIN`. The generated matrix is part of the immutable publication. No external QR image service or Android encoder dependency is used.

Only a successful manual publication or restore transaction activates the destination through the Programming port. Manual publication inserts or updates the stable link; restore updates an existing identity only and rejects a generation whose source layout/link has been deleted. The repository locks QR rows in identifier order for restore and cascading layout deletion, avoiding reverse layout/program lock acquisition. Drafts and automatic catalog price publications do not advance it. Every use of the same layout area shares its most recently explicitly published destination, including previously displayed copies of the code. Restoring deliberately restores that destination; a publication that is unchanged creates no new generation. Recreating the area with a different key/layout creates a different link. Deleting the layout cascades its links; a suspended company has no public resolution.

The public panel route resolves the current destination through `GET /q/{linkId}`, then navigates. It needs no human session and reveals only the approved public HTTPS destination. The link grants no tenant/API authority. A deployed panel origin must be reachable by scanning devices; localhost links serve local testing only.

## Live sources and cache bounds

The API alone fetches providers. Weather uses [MET Norway Locationforecast](https://api.met.no/weatherapi/locationforecast/2.0/documentation), identifies Teluni by User-Agent, credits [MET Norway / CC BY 4.0](https://api.met.no/doc/License), and caches identical coordinates for at least three hours, respecting later provider expiry up to the 24-hour cap. This initial provider needs no API key. RSS/Atom sources cache for at least 15 minutes. Failures have a one-minute retry cooldown. In-flight requests for the same source coalesce; one process holds at most 256 source entries and four concurrent fetches. A busy cache returns unavailable rather than opening unbounded work. Cache misses after an API restart fetch again.

Outbound sources require HTTPS, the standard port, no credentials, control characters or fragments. Every DNS answer must be public; connections pin a validated address while retaining TLS hostname/certificate verification. Every redirect is revalidated, with at most three redirects. Requests have a five-second total deadline, a two-second DNS wait, identity encoding and a 512 KiB body cap. XML refuses DTD/entity declarations, validates structure and enforces at most 32 simultaneously open elements through the parser’s own nesting limit, including quoted attributes and Unicode element names. Only bounded plain text, source labels and validated HTTPS article links cross the API boundary. No source bodies/URLs or arbitrary provider errors are logged.

`POST /companies/{companyId}/programming/widgets/preview` requires a human session, CSRF and `programming.edit` over the selected layout branch (company-wide for a company layout). `GET /device/publications/{publicationId}/widgets` uses credential-aware device limits and serves only the current desired publication; source configuration comes from its stored manifest, never device input. Refreshes do not create new publication generations. Device sidecars omit article URLs (`null`) because screens display headlines without following links; authenticated previews retain the validated links. Even twelve feeds with twenty 200-code-point headlines and 120-code-point source labels stay within the player’s 256 KiB response limit and three-generation 768 KiB cache limit. Player text bounds count Unicode code points consistently with the API.

## Player compatibility and offline behavior

Widget layouts publish protocol 3. Protocols 1/2 retain exact serialized content and remain supported. Install player version code 3 (`0.1.2`) before assigning widget publications. Older players report incompatibility and retain only still-authorized cached output. Apply the additive `20261116000000_layout_widgets` and `20261116010000_layout_widget_tenant_key` migrations and runtime grants before the new API/player. The second migration adds the explicit tenant-qualified key without rewriting the already applied first migration.

The portable core validates all configuration and live data, derives text/item selection, and applies the existing statement/trusted-clock gate before composing output. Native Android views draw text and QR modules without WebView. Updating a clock or forecast does not restart unrelated media or ticker animation. A generation-specific `widgets.json` cache uses AtomicFiles, preserves at most three generations, and is erased with the identity. It is an independent versioned record, so existing credential/state formats remain readable.

After activation and successful sync, live data refresh at most every 15 minutes, retrying failed transport and stale/unavailable sources after one minute. A newly activated generation refreshes immediately, independently of the previous generation’s interval. Freshness follows `validUntil`; source failures retain clearly stale data only until 24 hours after `fetchedAt`. Missing/expired data show an unavailable placeholder and report degraded playback while other authorized content continues. Caches never extend authorization or turn the device clock into trusted time.

## Verification and local examples

API checks cover all variants, export versions, QR decoding/stability and publish-only activation, device/tenant boundaries, canonical protocol bytes, bounded cache expiry, RSS/Atom parsing and pinned public networking including redirect/private-address rejection. Shared API-generated protocol 3 fixtures contain every type and are consumed by JVM parser/planner/cache tests. Existing protocol 1/2, catalog, schedule and player checks remain in the same gate. Browser checks configure/save all five variants and preserve drafts when a source is unavailable.

The local Café Aurora demo contains “Painel informativo · Componentes · Horizontal” and “Recepção conectada · Componentes · Vertical”, both using all five components. The horizontal example is assigned to the demo Android emulator through its own programming group. The example news source is the [React release Atom feed](https://github.com/react/react/releases.atom), displaying headline/source text only; its QR destination is the corresponding public release page. Verification includes publication-activated destination changes without changing the QR matrix. External sources may be unavailable; local verification is not a provider SLA or physical-player qualification.
