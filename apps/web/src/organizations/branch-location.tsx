import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "../components.js";
import { browserLocale } from "../locale.js";
import {
  searchOrganizationLocations,
  type BranchLocation,
  type CityLocation,
} from "./api.js";
import { organizationMessages } from "./messages.js";
import { BranchMap } from "./branch-map.js";

export function locationLabel(
  location: BranchLocation,
  locale: string,
): string {
  return `${location.latitude.toLocaleString(locale, { maximumFractionDigits: 6 })}, ${location.longitude.toLocaleString(locale, { maximumFractionDigits: 6 })}`;
}
function cityLabel(city: CityLocation, locale: string): string {
  const country = new Intl.DisplayNames([locale], { type: "region" }).of(
    city.countryCode,
  );
  return [city.name, city.region, country].filter(Boolean).join(", ");
}

/** The full address is entered locally; a confirmed map point owns the zone. */
export function BranchLocationField({
  value,
  required,
  disabled,
  onChange,
}: {
  value: BranchLocation | null;
  required: boolean;
  disabled: boolean;
  onChange: (value: BranchLocation) => void;
}) {
  const locale = browserLocale();
  const t = organizationMessages[locale];
  const id = useId();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [focus, setFocus] = useState<BranchLocation | null>(null);
  const [latitude, setLatitude] = useState(value ? String(value.latitude) : "");
  const [longitude, setLongitude] = useState(
    value ? String(value.longitude) : "",
  );
  useEffect(() => {
    setLatitude(value ? String(value.latitude) : "");
    setLongitude(value ? String(value.longitude) : "");
  }, [value]);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);
  const results = useQuery({
    queryKey: ["organization-locations", debounced],
    queryFn: () => searchOrganizationLocations(debounced),
    enabled: debounced.length >= 2 && !disabled,
    staleTime: 60_000,
  });
  const valid =
    latitude.trim() !== "" &&
    longitude.trim() !== "" &&
    Number.isFinite(Number(latitude)) &&
    Number.isFinite(Number(longitude)) &&
    Math.abs(Number(latitude)) <= 90 &&
    Math.abs(Number(longitude)) <= 180;
  return (
    <fieldset className="branch-location-field" disabled={disabled}>
      <legend>{t.fieldLocation}</legend>
      {value ? (
        <p className="branch-location-selected">
          <strong>{t.selectedLocation}</strong> {locationLabel(value, locale)}
        </p>
      ) : (
        <p className="hint">
          {required ? t.locationRequired : t.locationMissing}
        </p>
      )}
      <label htmlFor={`${id}-city`}>{t.citySearch}</label>
      <input
        id={`${id}-city`}
        type="search"
        value={query}
        maxLength={120}
        aria-describedby={`${id}-help`}
        onChange={(event) => setQuery(event.target.value)}
      />
      <p id={`${id}-help`} className="hint">
        {t.locationHelp}
      </p>
      {query.trim().length >= 2 && (
        <>
          {(query.trim() !== debounced || results.isFetching) && (
            <p role="status">{t.loading}</p>
          )}
          {query.trim() === debounced && results.isError && (
            <div role="alert">
              {t.locationFailed}{" "}
              <Button
                disabled={results.isFetching}
                onClick={() => void results.refetch()}
              >
                {t.reload}
              </Button>
            </div>
          )}
          {query.trim() === debounced && results.isSuccess && (
            <>
              <p role="status" className="hint">
                {results.data.length === 0
                  ? t.locationEmpty
                  : t.locationSelectResult}
              </p>
              <ul
                className="branch-location-results"
                aria-label={t.locationResults}
              >
                {results.data.map((city) => (
                  <li key={city.id}>
                    <Button
                      disabled={results.isFetching}
                      onClick={() => {
                        setFocus({
                          latitude: city.latitude,
                          longitude: city.longitude,
                        });
                        setQuery("");
                        setDebounced("");
                      }}
                    >
                      {cityLabel(city, locale)}
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      <BranchMap
        value={value}
        focus={focus}
        disabled={disabled}
        onChange={onChange}
      />
      <details className="branch-coordinates">
        <summary>{t.coordinatesAlternative}</summary>
        <label htmlFor={`${id}-latitude`}>{t.latitude}</label>
        <input
          id={`${id}-latitude`}
          type="number"
          step="any"
          min={-90}
          max={90}
          value={latitude}
          onChange={(event) => setLatitude(event.target.value)}
        />
        <label htmlFor={`${id}-longitude`}>{t.longitude}</label>
        <input
          id={`${id}-longitude`}
          type="number"
          step="any"
          min={-180}
          max={180}
          value={longitude}
          onChange={(event) => setLongitude(event.target.value)}
        />
        <Button
          disabled={!valid}
          onClick={() => {
            const point = {
              latitude: Number(latitude),
              longitude: Number(longitude),
            };
            onChange(point);
            setFocus(point);
          }}
        >
          {t.confirmPoint}
        </Button>
      </details>
      <p className="hint">
        {t.locationAttribution}{" "}
        <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">
          GeoNames
        </a>{" "}
        ·{" "}
        <a
          href="https://creativecommons.org/licenses/by/4.0/"
          target="_blank"
          rel="noreferrer"
        >
          CC BY 4.0
        </a>
      </p>
    </fieldset>
  );
}
