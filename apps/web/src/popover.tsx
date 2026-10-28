import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { UiIcon, type UiIconName } from "./ui-icon.js";
import "./popover.css";

const offset = 4;
const viewportMargin = 8;

/**
 * Places the popover below its anchor, above it when only that fits, and
 * otherwise as low as the viewport allows.
 */
function place(node: HTMLElement, anchor: HTMLElement, align: "start" | "end") {
  const rect = anchor.getBoundingClientRect();
  const { offsetWidth: width, offsetHeight: height } = node;
  const left = align === "end" ? rect.right - width : rect.left;
  const below = rect.bottom + offset;
  const above = rect.top - offset - height;
  const lowest = innerHeight - viewportMargin - height;
  const top =
    below <= lowest ? below : above >= viewportMargin ? above : lowest;
  node.style.left = `${Math.max(viewportMargin, Math.min(left, innerWidth - width - viewportMargin))}px`;
  node.style.top = `${Math.max(viewportMargin, top)}px`;
}

/**
 * A non-modal surface in the browser's top layer, placed next to its anchor
 * so scrolling containers never clip it. Escape, an outside click or another
 * popover closes it; focus that would otherwise be lost returns to the
 * anchor. Content renders only while open.
 */
export function Popover({
  anchor,
  returnFocus = anchor,
  open,
  onClose,
  label,
  id,
  role = "dialog",
  align = "start",
  className = "",
  onKeyDown,
  children,
}: {
  anchor: HTMLElement | null;
  /** Receives focus when the popover closes with focus inside it. */
  returnFocus?: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  label: string;
  id?: string;
  role?: "dialog" | "menu";
  align?: "start" | "end";
  className?: string;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !open || !anchor) return;
    if (!node.matches(":popover-open")) node.showPopover();
    const reposition = () => place(node, anchor, align);
    reposition();
    (node.querySelector<HTMLElement>("[data-autofocus]") ?? node).focus();
    addEventListener("resize", reposition);
    addEventListener("scroll", reposition, true);
    // Kept from opening: the caller may clear it in the same update that closes.
    const restore = returnFocus;
    return () => {
      removeEventListener("resize", reposition);
      removeEventListener("scroll", reposition, true);
      if (node.matches(":popover-open")) node.hidePopover();
      // Closing removes the content, so focus inside it falls to the body.
      const active = document.activeElement;
      if (
        restore?.isConnected &&
        (!active || active === document.body || node.contains(active))
      )
        restore.focus();
    };
  }, [open, anchor, align]);
  return (
    <div
      ref={ref}
      id={id}
      popover="auto"
      role={role}
      aria-label={label}
      tabIndex={-1}
      className={`ui-popover ${className}`.trim()}
      onKeyDown={onKeyDown}
      onToggle={(event) => {
        // Escape, an outside click or another popover closed it.
        if (event.newState === "closed" && open) onClose();
      }}
    >
      {open && children}
    </div>
  );
}

export type MenuItem = {
  /** Stable item identity. */
  key: string;
  label: string;
  onSelect: () => void;
  icon?: UiIconName;
  /** Shows a checked state, for example the active sort direction. */
  checked?: boolean;
  disabled?: boolean;
};

function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  const items = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(
      '[role^="menuitem"]:not(:disabled)',
    ),
  ];
  const index = items.indexOf(document.activeElement as HTMLElement);
  const target = {
    ArrowDown: items[(index + 1) % items.length],
    ArrowUp: items[(index - 1 + items.length) % items.length],
    Home: items[0],
    End: items.at(-1),
  }[event.key];
  if (!target) return;
  event.preventDefault();
  target.focus();
}

/**
 * A button that opens a list of actions. Arrow keys, Home and End move
 * between enabled items, Enter or Space chooses one, and Escape or Tab
 * closes the menu.
 */
export function Menu({
  label,
  items,
  align = "start",
  className = "",
  children,
  onClick,
  onKeyDown,
  ref,
  ...props
}: Omit<ComponentPropsWithRef<"button">, "children" | "type"> & {
  /** Names both the trigger and the menu. */
  label: string;
  items: readonly MenuItem[];
  align?: "start" | "end";
  /** Trigger content, usually an icon. */
  children: ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [fromEnd, setFromEnd] = useState(false);
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const attachTrigger = useCallback(
    (node: HTMLButtonElement | null) => {
      setTrigger(node);
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );
  const enabled = items.filter((item) => !item.disabled);
  const initial = fromEnd ? enabled.at(-1) : enabled[0];
  const checkable = items.some((item) => item.checked !== undefined);
  return (
    <>
      <button
        {...props}
        ref={attachTrigger}
        type="button"
        className={`ui-menu-trigger ${className}`.trim()}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        // The native relation keeps the trigger outside light dismiss;
        // React state still decides when the menu opens.
        popoverTarget={id}
        onClick={(event) => {
          onClick?.(event);
          event.preventDefault();
          setFromEnd(false);
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          setFromEnd(event.key === "ArrowUp");
          setOpen(true);
        }}
      >
        {children}
      </button>
      <Popover
        id={id}
        anchor={trigger}
        open={open}
        onClose={() => setOpen(false)}
        label={label}
        role="menu"
        align={align}
        className="ui-menu"
        onKeyDown={(event) => {
          if (event.key === "Tab") setOpen(false);
          else moveFocus(event);
        }}
      >
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
            aria-checked={item.checked}
            tabIndex={-1}
            disabled={item.disabled}
            data-autofocus={item === initial ? "" : undefined}
            className="ui-menu-item"
            onClick={() => {
              setOpen(false);
              item.onSelect();
            }}
          >
            {checkable && (
              <span className="ui-menu-check">
                {item.checked && <UiIcon name="check" />}
              </span>
            )}
            {item.icon && <UiIcon name={item.icon} />}
            <span>{item.label}</span>
          </button>
        ))}
      </Popover>
    </>
  );
}
