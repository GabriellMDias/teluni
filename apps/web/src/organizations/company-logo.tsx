import { useEffect, useRef, useState } from "react";
import { Button } from "../components.js";
import { browserLocale } from "../locale.js";
import { organizationMessages } from "./messages.js";

/** Feature-local image admission and preview; the API validates the PNG again. */
export function CompanyLogoField({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: string | null;
  disabled: boolean;
  onChange: (value: string | null) => void;
}) {
  const t = organizationMessages[browserLocale()];
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  async function choose(file: File | undefined) {
    if (!file) return;
    const attempt = ++generation.current;
    setError(false);
    setBusy(true);
    input.current?.setCustomValidity(t.logoProcessing);
    try {
      if (
        !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
        file.size > 5 * 1024 * 1024
      )
        throw new Error("Invalid logo file");
      const bitmap = await createImageBitmap(file);
      try {
        if (bitmap.width > 4096 || bitmap.height > 4096)
          throw new Error("Invalid logo dimensions");
        const scale = Math.min(1, 256 / bitmap.width, 256 / bitmap.height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas unavailable");
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const result = canvas.toDataURL("image/png");
        if (result.length > 350_000) throw new Error("Logo too large");
        if (generation.current === attempt) {
          onChange(result);
          input.current?.setCustomValidity("");
        }
      } finally {
        bitmap.close();
      }
    } catch {
      if (generation.current === attempt) {
        setError(true);
        input.current?.setCustomValidity(t.logoInvalid);
      }
    } finally {
      if (generation.current === attempt) setBusy(false);
    }
  }
  return (
    <fieldset
      className="company-logo-field"
      disabled={disabled}
      aria-busy={busy}
    >
      <legend>{t.fieldLogo}</legend>
      {value && (
        <img
          className="company-logo-preview"
          src={value}
          alt={t.logoPreview}
          width={88}
          height={88}
        />
      )}
      <label htmlFor={id}>{value ? t.replaceLogo : t.chooseLogo}</label>
      <input
        ref={input}
        id={id}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
        aria-invalid={error || undefined}
        onChange={(event) => void choose(event.target.files?.[0])}
      />
      <p id={`${id}-help`} className="hint">
        {t.logoHelp}
      </p>
      {busy && <p role="status">{t.logoProcessing}</p>}
      {error && (
        <p id={`${id}-error`} role="alert">
          {t.logoInvalid}
        </p>
      )}
      {(value || error) && (
        <Button
          onClick={() => {
            generation.current++;
            setError(false);
            if (input.current) {
              input.current.value = "";
              input.current.setCustomValidity("");
            }
            onChange(null);
          }}
        >
          {t.removeLogo}
        </Button>
      )}
    </fieldset>
  );
}
