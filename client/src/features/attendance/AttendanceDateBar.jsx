import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge, Button, Card, CardBody, DatePicker } from "../../components/ui";
import { addDaysISO, formatLongDate } from "../../utils/formatDate";

const arrowButton =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-fg transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-40 sm:h-10 sm:w-10";

/** Day picker: previous / next arrows + native date field. Future days are not allowed. */
export default function AttendanceDateBar({ date, today, onChange }) {
  const isToday = date === today;

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Previous day" className={arrowButton} onClick={() => onChange(addDaysISO(date, -1))}>
            <ChevronLeft className="h-5 w-5" />
          </button>
          <DatePicker
            aria-label="Attendance date"
            value={date}
            max={today}
            onChange={(e) => onChange(e.target.value)}
            wrapperClassName="flex-1"
          />
          <button
            type="button"
            aria-label="Next day"
            className={arrowButton}
            disabled={date >= today}
            onClick={() => onChange(addDaysISO(date, 1))}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">{formatLongDate(date)}</p>
          {isToday ? (
            <Badge variant="success" size="sm">
              Today
            </Badge>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => onChange(today)} className="text-primary hover:text-primary">
              Back to today
            </Button>
          )}
        </div>

        {!isToday && <p className="type-small">You are editing a previous day. Changes are recorded in the audit log.</p>}
      </CardBody>
    </Card>
  );
}
