import { useCallback, useEffect, useMemo, useState } from "react";
import { Save } from "lucide-react";
import { Button, ConfirmDialog, useToast } from "../components/ui";
import AttendanceDateBar from "../features/attendance/AttendanceDateBar";
import AttendanceList from "../features/attendance/AttendanceList";
import { getEligibleLabours, summarize } from "../features/attendance/attendanceSelectors";
import AttendanceSummaryBar from "../features/attendance/AttendanceSummaryBar";
import AttendanceToolbar from "../features/attendance/AttendanceToolbar";
import { filterLabours } from "../features/labours/labourSelectors";
import useLabours from "../features/labours/useLabours";
import { formatDate, toISODate } from "../utils/formatDate";

/**
 * Daily attendance sheet.
 * `draft` holds only the taps made since the last save; a labour's shown status is draft ?? saved ?? null.
 */
export default function Attendance() {
  const toast = useToast();
  const { labours, getAttendanceByDate, saveAttendance } = useLabours();

  const today = toISODate();
  const [date, setDate] = useState(today);
  const [draft, setDraft] = useState({});
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL"); // ALL | UNMARKED
  const [pendingDate, setPendingDate] = useState(null); // date waiting for "discard changes?" answer
  const [confirmSave, setConfirmSave] = useState(false);

  const saved = useMemo(() => getAttendanceByDate(date), [getAttendanceByDate, date]);
  const eligible = useMemo(() => getEligibleLabours(labours, date, saved), [labours, date, saved]);

  const statusOf = useCallback((id) => draft[id] ?? saved[id] ?? null, [draft, saved]);
  const counts = useMemo(() => summarize(eligible, statusOf), [eligible, statusOf]);

  // Labour whose status was changed from what is saved.
  const changes = useMemo(
    () => eligible.filter((l) => draft[l.id] && draft[l.id] !== saved[l.id]),
    [eligible, draft, saved]
  );
  const dirty = changes.length > 0;

  const visible = useMemo(() => {
    const searched = filterLabours(eligible, { search });
    return filter === "UNMARKED" ? searched.filter((l) => !statusOf(l.id)) : searched;
  }, [eligible, search, filter, statusOf]);

  // Browser warning if the tab is closed with unsaved taps.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const handleChange = useCallback((id, status) => setDraft((d) => ({ ...d, [id]: status })), []);

  const markAllPresent = () => {
    setDraft((d) => {
      const next = { ...d };
      visible.forEach((l) => {
        next[l.id] = "PRESENT";
      });
      return next;
    });
    toast.success(`${visible.length} marked present`);
  };

  const applyDate = (next) => {
    setDate(next);
    setDraft({});
    setSearch("");
    setFilter("ALL");
  };

  const requestDateChange = (next) => {
    if (!next || next > today || next === date) return;
    if (dirty) setPendingDate(next);
    else applyDate(next);
  };

  const doSave = () => {
    saveAttendance(
      date,
      changes.map((l) => ({ labourId: l.id, status: draft[l.id] }))
    );
    setDraft({});
    setConfirmSave(false);
    toast.success(`Attendance saved for ${formatDate(date)}`);
  };

  const requestSave = () => {
    if (counts.unmarked > 0) setConfirmSave(true);
    else doSave();
  };

  const saveButton = (extraClass) => (
    <Button leftIcon={Save} onClick={requestSave} disabled={!dirty} className={extraClass}>
      Save Attendance
    </Button>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="type-page-heading">Attendance</h1>
          <p className="mt-1 text-sm text-fg-muted">Mark who worked today: present, half day or absent.</p>
        </div>
        <div className="hidden lg:block">{saveButton()}</div>
      </div>

      <AttendanceDateBar date={date} today={today} onChange={requestDateChange} />

      <AttendanceSummaryBar counts={counts} />

      <AttendanceToolbar
        search={search}
        onSearchChange={setSearch}
        filter={filter}
        onFilterChange={setFilter}
        totals={{ all: eligible.length, unmarked: counts.unmarked }}
        shownCount={visible.length}
        onMarkAllPresent={markAllPresent}
      />

      <AttendanceList
        labours={visible}
        statusOf={statusOf}
        onChange={handleChange}
        emptyTitle={eligible.length === 0 ? "No labour for this date" : filter === "UNMARKED" && !search.trim() ? "Everyone is marked" : "No labour found"}
        emptyDescription={
          eligible.length === 0
            ? "Active labour who had joined by this date appear here."
            : filter === "UNMARKED" && !search.trim()
              ? "Every labour has a status for this day."
              : "Try a different search."
        }
      />

      {/* Extra space so the fixed save bar never covers the last row */}
      <div className="h-20 lg:hidden" aria-hidden="true" />

      {/* Phones / tablets: save bar above the bottom navigation */}
      <div className="fixed inset-x-0 bottom-[calc(3.9rem+env(safe-area-inset-bottom))] z-30 flex items-center gap-3 border-t border-border bg-surface px-4 py-3 shadow-pop lg:hidden">
        <p className="min-w-0 flex-1 text-sm">
          {dirty ? (
            <span className="font-medium text-fg">{changes.length} unsaved {changes.length === 1 ? "change" : "changes"}</span>
          ) : (
            <span className="text-fg-muted">All changes saved</span>
          )}
        </p>
        {saveButton("shrink-0")}
      </div>

      <ConfirmDialog
        open={confirmSave}
        variant="primary"
        title="Some labour not marked"
        message={`${counts.unmarked} ${counts.unmarked === 1 ? "labour has" : "labours have"} no status for ${formatDate(date)}. They will have no attendance (0 days) for this day. Save anyway?`}
        confirmText="Save anyway"
        cancelText="Keep marking"
        onConfirm={doSave}
        onCancel={() => setConfirmSave(false)}
      />

      <ConfirmDialog
        open={Boolean(pendingDate)}
        variant="danger"
        title="Discard unsaved changes?"
        message={`You have ${changes.length} unsaved ${changes.length === 1 ? "change" : "changes"} for ${formatDate(date)}. Switching day will discard them.`}
        confirmText="Discard and switch"
        cancelText="Stay here"
        onConfirm={() => {
          applyDate(pendingDate);
          setPendingDate(null);
        }}
        onCancel={() => setPendingDate(null)}
      />
    </div>
  );
}
