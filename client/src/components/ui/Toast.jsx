import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "../../utils/cn";

const ToastContext = createContext(null);

const types = {
  success: { icon: CheckCircle2, color: "text-success", bar: "bg-success" },
  error: { icon: XCircle, color: "text-danger", bar: "bg-danger" },
  warning: { icon: AlertTriangle, color: "text-warning", bar: "bg-warning" },
  info: { icon: Info, color: "text-primary", bar: "bg-primary" },
};

/**
 * Wrap the app once (e.g. in App.jsx):  <ToastProvider><AppRoutes /></ToastProvider>
 * Then anywhere:  const toast = useToast();  toast.success("Labour added");
 */
export function ToastProvider({ children, duration = 4000 }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (type, message, options = {}) => {
      const id = ++idRef.current;
      setToasts((list) => [...list.slice(-3), { id, type, message, title: options.title }]);
      const ms = options.duration ?? duration;
      if (ms > 0) timers.current.set(id, setTimeout(() => dismiss(id), ms));
      return id;
    },
    [dismiss, duration]
  );

  const api = useMemo(
    () => ({
      show,
      dismiss,
      success: (message, options) => show("success", message, options),
      error: (message, options) => show("error", message, options),
      warning: (message, options) => show("warning", message, options),
      info: (message, options) => show("info", message, options),
    }),
    [show, dismiss]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-3 sm:inset-x-auto sm:right-4 sm:top-4 sm:items-end">
          {toasts.map((t) => {
            const { icon: Icon, color, bar } = types[t.type];
            return (
              <div
                key={t.id}
                role={t.type === "error" ? "alert" : "status"}
                className="pointer-events-auto relative flex w-full max-w-sm animate-toast-in items-start gap-3 overflow-hidden rounded-lg border border-border bg-surface p-3 pl-4 shadow-pop"
              >
                <span className={cn("absolute inset-y-0 left-0 w-1", bar)} aria-hidden="true" />
                <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", color)} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  {t.title && <p className="text-sm font-semibold text-fg">{t.title}</p>}
                  <p className={cn("text-sm", t.title ? "text-fg-muted" : "text-fg")}>{t.message}</p>
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(t.id)}
                  aria-label="Dismiss notification"
                  className="shrink-0 rounded p-1 text-fg-muted hover:bg-background hover:text-fg"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
