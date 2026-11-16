import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "../components.js";
import { browserLocale } from "../locale.js";
import { qrDestination } from "./api.js";
import { widgetMessages } from "./widget-messages.js";

/** A published QR is a public capability to one destination, never a session or tenant identifier. */
export function PublishedQr({ linkId }: { linkId: string }) {
  const t = widgetMessages[browserLocale()];
  const destination = useQuery({
    queryKey: ["published-qr", linkId],
    queryFn: () => qrDestination(linkId),
    retry: false,
    staleTime: 0,
  });
  useEffect(() => {
    if (!destination.data) return;
    const url = new URL(destination.data.url);
    if (url.protocol === "https:" && !url.username && !url.password)
      window.location.replace(url.href);
  }, [destination.data]);
  return (
    <main className="widget-public-qr">
      <p role="status">{destination.isError ? t.qrMissing : t.qrOpening}</p>
      {destination.data && (
        <a href={destination.data.url} rel="noreferrer">
          {t.qrContinue}
        </a>
      )}
      {destination.isError && (
        <Button onClick={() => void destination.refetch()}>{t.qrRetry}</Button>
      )}
    </main>
  );
}
