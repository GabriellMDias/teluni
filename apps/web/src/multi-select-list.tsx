import { useDeferredValue, useId, useMemo, useRef, useState } from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { Checkbox, TextField } from "./controls.js";
import type { Locale } from "./locale.js";
import "./multi-select-list.css";

const messages = {
  "pt-BR": {
    search: "Pesquisar",
    selectAll: "Selecionar tudo",
    selectResults: "Selecionar todos os resultados",
    noResults: "Nenhum valor encontrado.",
  },
  "en-US": {
    search: "Search",
    selectAll: "Select all",
    selectResults: "Select all results",
    noResults: "No values found.",
  },
} as const;

export type MultiSelectOption = {
  /** Stable option identity, kept in the selection. */
  value: string;
  label: string;
};

const optionHeight = 32;

function searchable(text: string, locale: Locale) {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase(locale);
}

// Normalized labels, computed once per options list.
const searchIndexes = new WeakMap<
  readonly MultiSelectOption[],
  { locale: Locale; labels: string[] }
>();

/** Options whose label contains the query, ignoring case and accents. */
export function searchOptions(
  options: readonly MultiSelectOption[],
  query: string,
  locale: Locale,
): readonly MultiSelectOption[] {
  const search = searchable(query.trim(), locale);
  if (!search) return options;
  let index = searchIndexes.get(options);
  if (index?.locale !== locale) {
    index = {
      locale,
      labels: options.map((option) => searchable(option.label, locale)),
    };
    searchIndexes.set(options, index);
  }
  const { labels } = index;
  return options.filter((_, position) => labels[position].includes(search));
}

/**
 * A searchable multi-select list with select-all. Only the options in view
 * are rendered, so it stays responsive with very many options; arrow keys
 * move through all of them and Space toggles the active one.
 */
export function MultiSelectList({
  label,
  locale,
  options,
  selected,
  onChange,
  query: controlledQuery,
  onQueryChange,
  height = 240,
}: {
  label: string;
  locale: Locale;
  /** Options in display order. */
  options: readonly MultiSelectOption[];
  selected: ReadonlySet<string>;
  onChange: (selected: Set<string>) => void;
  /** Search text, when the caller needs it; see searchOptions. */
  query?: string;
  onQueryChange?: (query: string) => void;
  /** Maximum height of the scrolling list in pixels. */
  height?: number;
}) {
  // The virtualizer keeps one instance whose output changes while scrolling.
  "use no memo";
  const t = messages[locale];
  const id = useId();
  const [ownQuery, setOwnQuery] = useState("");
  const query = controlledQuery ?? ownQuery;
  const deferredQuery = useDeferredValue(query);
  const searching = deferredQuery.trim() !== "";
  const visible = useMemo(
    () => searchOptions(options, deferredQuery, locale),
    [options, deferredQuery, locale],
  );
  const [active, setActive] = useState(0);
  const activeIndex = Math.min(active, visible.length - 1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => optionHeight,
    getItemKey: (index) => visible[index].value,
    initialRect: { width: 0, height },
    overscan: 6,
    // Keep the active option rendered so assistive technology can reach it.
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range);
      return activeIndex < 0 || indexes.includes(activeIndex)
        ? indexes
        : [...indexes, activeIndex].sort((a, b) => a - b);
    },
  });
  const chosen = visible.reduce(
    (count, option) => count + Number(selected.has(option.value)),
    0,
  );
  const allChosen = visible.length > 0 && chosen === visible.length;
  const toggle = (value: string) => {
    const next = new Set(selected);
    if (!next.delete(value)) next.add(value);
    onChange(next);
  };
  const toggleVisible = () => {
    const next = new Set(selected);
    for (const option of visible)
      if (allChosen) next.delete(option.value);
      else next.add(option.value);
    onChange(next);
  };
  const moveTo = (index: number) => {
    const target = Math.max(0, Math.min(index, visible.length - 1));
    setActive(target);
    virtualizer.scrollToIndex(target);
  };
  const page = Math.max(1, Math.floor(height / optionHeight) - 1);
  return (
    <div className="ui-multiselect">
      <TextField
        type="search"
        label={t.search}
        value={query}
        autoComplete="off"
        data-autofocus=""
        onChange={(event) => {
          setOwnQuery(event.target.value);
          onQueryChange?.(event.target.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" || !scrollRef.current) return;
          event.preventDefault();
          scrollRef.current.focus();
        }}
      />
      <Checkbox
        label={searching ? t.selectResults : t.selectAll}
        checked={allChosen}
        indeterminate={chosen > 0 && !allChosen}
        disabled={visible.length === 0}
        onChange={toggleVisible}
      />
      {visible.length === 0 ? (
        <p className="ui-multiselect-empty">{t.noResults}</p>
      ) : (
        <div
          ref={scrollRef}
          className="ui-multiselect-list"
          role="listbox"
          aria-label={label}
          aria-multiselectable="true"
          aria-activedescendant={`${id}-${activeIndex}`}
          tabIndex={0}
          style={{ maxHeight: height }}
          onKeyDown={(event) => {
            const target = {
              ArrowDown: activeIndex + 1,
              ArrowUp: activeIndex - 1,
              PageDown: activeIndex + page,
              PageUp: activeIndex - page,
              Home: 0,
              End: visible.length - 1,
            }[event.key];
            if (target !== undefined) moveTo(target);
            else if (event.key === " ") toggle(visible[activeIndex].value);
            else return;
            event.preventDefault();
          }}
        >
          <div
            role="presentation"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const option = visible[item.index];
              const checked = selected.has(option.value);
              return (
                <div
                  key={item.key}
                  id={`${id}-${item.index}`}
                  role="option"
                  aria-selected={checked}
                  aria-posinset={item.index + 1}
                  aria-setsize={visible.length}
                  className="ui-multiselect-option"
                  data-active={item.index === activeIndex || undefined}
                  style={{
                    height: optionHeight,
                    transform: `translateY(${item.start}px)`,
                  }}
                  onClick={() => {
                    setActive(item.index);
                    toggle(option.value);
                  }}
                >
                  <span
                    className="ui-checkbox-box"
                    data-checked={checked}
                    aria-hidden="true"
                  />
                  <span className="ui-multiselect-label">{option.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
