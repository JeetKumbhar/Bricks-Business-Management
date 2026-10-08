import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreVertical } from "lucide-react";
import { cn } from "../../utils/cn";

/**
 * Action menu. The menu is rendered in a portal with fixed position, so it is
 * never clipped by scrollable table containers.
 *
 * <Dropdown items={[
 *   { label: "View", icon: Eye, onClick: () => {} },
 *   { type: "divider" },
 *   { label: "Delete", icon: Trash2, variant: "danger", onClick: () => {} },
 * ]} />
 *
 * `trigger` defaults to a "more" (⋮) icon. Pass any node to customise it.
 */
export default function Dropdown({
  trigger,
  items = [],
  align = "right",
  ariaLabel = "Open menu",
  triggerClassName,
  menuClassName,
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const close = useCallback(() => setOpen(false), []);

  // Position after the menu is in the DOM (so we know its size), before paint.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !menuRef.current) return;
    const t = triggerRef.current.getBoundingClientRect();
    const m = menuRef.current.getBoundingClientRect();

    let top = t.bottom + 4;
    if (top + m.height > window.innerHeight - 8) top = Math.max(8, t.top - m.height - 4);

    let left = align === "right" ? t.right - m.width : t.left;
    left = Math.min(Math.max(8, left), window.innerWidth - m.width - 8);

    setPos({ top, left });
  }, [open, align]);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (e) => {
      if (menuRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      close();
    };
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open, close]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={cn(
          "inline-flex items-center justify-center rounded-lg p-2 text-fg-muted hover:bg-background hover:text-fg",
          triggerClassName
        )}
      >
        {trigger ?? <MoreVertical className="h-4 w-4" />}
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ top: pos.top, left: pos.left }}
            className={cn(
              "fixed z-50 min-w-44 animate-fade-in rounded-lg border border-border bg-surface p-1 shadow-pop",
              menuClassName
            )}
          >
            {items.map((item, i) => {
              if (item.type === "divider") {
                return <div key={`divider-${i}`} role="separator" className="my-1 h-px bg-border" />;
              }
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    close();
                    item.onClick?.();
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-3 py-3 text-left sm:py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50",
                    item.variant === "danger"
                      ? "text-danger hover:bg-danger-soft"
                      : "text-fg hover:bg-background"
                  )}
                >
                  {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
                  {item.label}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}
