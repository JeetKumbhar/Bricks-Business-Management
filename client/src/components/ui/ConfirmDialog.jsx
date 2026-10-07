import { useState } from "react";
import { AlertTriangle, HelpCircle } from "lucide-react";
import Button from "./Button";
import Modal from "./Modal";
import Textarea from "./Textarea";

/**
 * <ConfirmDialog
 *   open={open}
 *   title="Delete payment?"
 *   message="The balance will be recalculated."
 *   confirmText="Delete"
 *   requireReason            // BUSINESS_RULES: reason is mandatory for deletes/corrections
 *   onConfirm={(reason) => ...}
 *   onCancel={() => setOpen(false)}
 * />
 * Inner component is mounted only while open, so the reason field resets every time.
 */
function ConfirmDialogContent({
  title,
  message,
  confirmText,
  cancelText,
  variant,
  loading,
  requireReason,
  reasonLabel,
  onConfirm,
  onCancel,
}) {
  const [reason, setReason] = useState("");
  const danger = variant === "danger";
  const Icon = danger ? AlertTriangle : HelpCircle;
  const blocked = requireReason && !reason.trim();

  return (
    <Modal
      open
      size="sm"
      title={title}
      hideClose
      onClose={loading ? undefined : onCancel}
      closeOnOverlay={!loading}
      footer={
        <>
          <Button variant="outline" onClick={onCancel} disabled={loading}>
            {cancelText}
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            loading={loading}
            disabled={blocked}
            onClick={() => onConfirm?.(requireReason ? reason.trim() : undefined)}
          >
            {confirmText}
          </Button>
        </>
      }
    >
      <div className="flex gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
            danger ? "bg-danger-soft text-danger" : "bg-primary-soft text-primary"
          }`}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          {message && <p className="type-body text-fg-muted">{message}</p>}
          {requireReason && (
            <Textarea
              label={reasonLabel}
              required
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this needed?"
              autoFocus
            />
          )}
        </div>
      </div>
    </Modal>
  );
}

export default function ConfirmDialog({
  open,
  title = "Are you sure?",
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "danger",
  loading = false,
  requireReason = false,
  reasonLabel = "Reason",
  onConfirm,
  onCancel,
}) {
  if (!open) return null;
  return (
    <ConfirmDialogContent
      title={title}
      message={message}
      confirmText={confirmText}
      cancelText={cancelText}
      variant={variant}
      loading={loading}
      requireReason={requireReason}
      reasonLabel={reasonLabel}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
