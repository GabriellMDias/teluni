import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import type { BranchLocation } from "./api.js";
import { Button } from "../components.js";
import { browserLocale } from "../locale.js";
import { organizationMessages } from "./messages.js";

/** An interactive map with a keyboard and coordinate alternative. */
export function BranchMap({
  value,
  focus,
  disabled,
  onChange,
}: {
  value: BranchLocation | null;
  focus: BranchLocation | null;
  disabled: boolean;
  onChange: (point: BranchLocation) => void;
}) {
  const t = organizationMessages[browserLocale()];
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const marker = useRef<Leaflet.Marker | null>(null);
  const leaflet = useRef<typeof Leaflet | null>(null);
  const latest = useRef({ value, focus, disabled, onChange });
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    latest.current = { value, focus, disabled, onChange };
  }, [value, focus, disabled, onChange]);
  useEffect(() => {
    let disposed = false;
    let resize: ResizeObserver | undefined;
    void import("leaflet")
      .then((L) => {
        if (disposed || !container.current) return;
        leaflet.current = L;
        const selected = latest.current.value;
        const center = latest.current.focus ?? selected;
        const instance = L.map(container.current, {
          scrollWheelZoom: false,
          worldCopyJump: true,
          zoomControl: false,
        }).setView(
          center ? [center.latitude, center.longitude] : [-14.2, -51.9],
          center ? 16 : 4,
        );
        map.current = instance;
        L.control
          .zoom({ zoomInTitle: t.mapZoomIn, zoomOutTitle: t.mapZoomOut })
          .addTo(instance);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          referrerPolicy: "strict-origin-when-cross-origin",
        })
          .on("tileerror", () => {
            if (!disposed) setFailed(true);
          })
          .addTo(instance);
        const choose = (point: Leaflet.LatLng) => {
          if (!latest.current.disabled)
            latest.current.onChange({
              latitude: point.lat,
              longitude: point.wrap().lng,
            });
        };
        instance.on("click", (event: Leaflet.LeafletMouseEvent) =>
          choose(event.latlng),
        );
        instance.on("keypress", (event: Leaflet.LeafletKeyboardEvent) => {
          if (event.originalEvent.key === "Enter") {
            event.originalEvent.preventDefault();
            choose(instance.getCenter());
          }
        });
        resize = new ResizeObserver(() => instance.invalidateSize());
        resize.observe(container.current);
        if (selected) {
          marker.current = L.marker([selected.latitude, selected.longitude], {
            draggable: !latest.current.disabled,
            title: t.mapMarker,
            icon: L.divIcon({
              className: "branch-map-pin",
              html: '<span aria-hidden="true"></span>',
              iconSize: [28, 36],
              iconAnchor: [14, 36],
            }),
          }).addTo(instance);
          marker.current.on("dragend", () => {
            const point = marker.current?.getLatLng();
            if (point) choose(point);
          });
        }
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      resize?.disconnect();
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
  }, [t, retry]);
  useEffect(() => {
    if (!value || !map.current || !leaflet.current) return;
    const L = leaflet.current;
    if (!marker.current) {
      marker.current = L.marker([value.latitude, value.longitude], {
        draggable: !disabled,
        title: t.mapMarker,
        icon: L.divIcon({
          className: "branch-map-pin",
          html: '<span aria-hidden="true"></span>',
          iconSize: [28, 36],
          iconAnchor: [14, 36],
        }),
      }).addTo(map.current);
      marker.current.on("dragend", () => {
        const point = marker.current?.getLatLng();
        if (point && !latest.current.disabled)
          latest.current.onChange({
            latitude: point.lat,
            longitude: point.wrap().lng,
          });
      });
    } else marker.current.setLatLng([value.latitude, value.longitude]);
    if (disabled) marker.current.dragging?.disable();
    else marker.current.dragging?.enable();
    if (!map.current.getBounds().contains([value.latitude, value.longitude]))
      map.current.panTo([value.latitude, value.longitude]);
  }, [value, disabled, t]);
  useEffect(() => {
    if (focus && map.current)
      map.current.setView([focus.latitude, focus.longitude], 16, {
        animate: false,
      });
  }, [focus]);
  return (
    <>
      <div
        ref={container}
        className="branch-map"
        role="region"
        aria-label={t.branchMap}
        aria-describedby="branch-map-help"
      />
      <p id="branch-map-help" className="hint">
        {t.mapHelp}
      </p>
      {failed && (
        <div role="status" className="hint">
          {t.mapFailed}{" "}
          <Button
            onClick={() => {
              setFailed(false);
              setRetry((attempt) => attempt + 1);
            }}
          >
            {t.reload}
          </Button>
        </div>
      )}
    </>
  );
}
