import { useMemo, useState } from "react";
import { Truck as TruckIcon } from "lucide-react";
import { Button, Card, EmptyState } from "../../components/ui";
import TruckCard from "./TruckCard";
import TruckFilters from "./TruckFilters";
import TruckSummaryTiles from "./TruckSummaryTiles";

/** The original Trucks list: status tiles, search, and one card per truck. Search also matches the nickname. */
export default function TruckListPanel({ trucks, summary, onUpdateStatus, onHistory, onEdit }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return trucks.filter(
      (t) =>
        (status === "ALL" || t.status === status) &&
        (!q ||
          t.truckNumber.toLowerCase().includes(q) ||
          (t.nickname ?? "").toLowerCase().includes(q) ||
          t.model.toLowerCase().includes(q) ||
          (t.driverName ?? "").toLowerCase().includes(q))
    );
  }, [trucks, search, status]);

  return (
    <div className="space-y-4 sm:space-y-5">
      <TruckSummaryTiles summary={summary} status={status} onSelect={setStatus} />
      <TruckFilters search={search} onSearchChange={setSearch} status={status} onStatusChange={setStatus} summary={summary} />

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={TruckIcon}
            title="No trucks found"
            description="Try a different search or status."
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setSearch("");
                  setStatus("ALL");
                }}
              >
                Clear filters
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((t) => (
            <TruckCard key={t.id} truck={t} onUpdateStatus={onUpdateStatus} onDetails={onHistory} onEdit={onEdit} />
          ))}
        </div>
      )}
    </div>
  );
}
