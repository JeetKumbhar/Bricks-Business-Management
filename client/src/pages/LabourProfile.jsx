import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Users } from "lucide-react";
import { Button, ConfirmDialog, EmptyState, Tabs, useToast } from "../components/ui";
import EditLabourModal from "../features/labours/EditLabourModal";
import useLabours from "../features/labours/useLabours";
import AttendanceTab from "../features/labours/profile/AttendanceTab";
import ChangeRateModal from "../features/labours/profile/ChangeRateModal";
import OverviewTab from "../features/labours/profile/OverviewTab";
import PaymentsTab from "../features/labours/profile/PaymentsTab";
import ProfileHeader from "../features/labours/profile/ProfileHeader";
import { getProfileTabs } from "../features/labours/profile/profileTabs";
import RateHistoryTab from "../features/labours/profile/RateHistoryTab";
import TeamProductionCard from "../features/production/TeamProductionCard";
import ProductionSummary from "../features/production/ProductionSummary";
import MaapWorkHistoryCard from "../features/work/maapvali/MaapWorkHistoryCard";
import { formatCurrency } from "../utils/formatCurrency";
import { formatDate } from "../utils/formatDate";
import { LABOUR_STATUS } from "../utils/labourStatus";
import { LABOUR_TYPES } from "../utils/labourTypes";

/**
 * One profile for every labour type. The tabs follow the type:
 *  Bigari:    Overview, Attendance, Payments, Rate History
 *  Maapvali:  Overview, Maap Work, Payments, Rate
 *  Patlavale: Overview, Production, Payments, Team Rate
 * Work history and payments are on separate tabs. Payments never change work or production.
 */
export default function LabourProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const { getAnyLabour, getAttendance, getPayments, getRateHistory, updateLabour, isMobileTaken, changeRate } = useLabours();

  const [editOpen, setEditOpen] = useState(false);
  const [toggleOpen, setToggleOpen] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);

  const labour = getAnyLabour(id);

  if (!labour) {
    return (
      <EmptyState
        icon={Users}
        title="Labour not found"
        description={`There is no labour with ID ${id}.`}
        action={<Button onClick={() => navigate("/labours")}>Back to Labour list</Button>}
      />
    );
  }

  const type = labour.labourType;
  const isBigari = type === LABOUR_TYPES.BIGARI;
  const isMaapvali = type === LABOUR_TYPES.MAAPVALI;
  const isPatlavale = type === LABOUR_TYPES.PATLAVALE;

  const tabs = getProfileTabs(type);
  const requestedTab = params.get("tab");
  const tab = tabs.some((t) => t.id === requestedTab) ? requestedTab : "overview"; // a tab that does not apply falls back to Overview
  const setTab = (next) => setParams(next === "overview" ? {} : { tab: next }, { replace: true });

  const rateHistory = getRateHistory(labour.id);
  const isActive = labour.status === LABOUR_STATUS.ACTIVE;

  const handleEdit = (labourId, values) => {
    updateLabour(labourId, values); // only name, mobile, village, joining date and status are applied
    setEditOpen(false);
    toast.success("Labour updated");
  };

  const handleToggleConfirm = () => {
    const next = isActive ? LABOUR_STATUS.INACTIVE : LABOUR_STATUS.ACTIVE;
    updateLabour(labour.id, { status: next });
    setToggleOpen(false);
    toast.success(`${labour.name} marked ${isActive ? "inactive" : "active"}`);
  };

  const handleRateChange = (values) => {
    changeRate(labour.id, { rate: values.newRate, effectiveFrom: values.effectiveFrom, reason: values.reason });
    setRateOpen(false);
    toast.success(`Rate set to ${formatCurrency(values.newRate)} from ${formatDate(values.effectiveFrom)}`);
  };

  const payments = <PaymentsTab labour={labour} payments={getPayments(labour.id)} />;

  return (
    <div className="space-y-4">
      <Link to="/labours" className="inline-flex items-center gap-1.5 py-1 text-sm font-medium text-primary">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Labour list
      </Link>

      <ProfileHeader labour={labour} onEdit={() => setEditOpen(true)} onToggleStatus={() => setToggleOpen(true)} />

      {/* Sticks under the header while the tab content scrolls (matches main padding so it spans edge to edge) */}
      <div className="sticky top-16 z-20 -mx-4 bg-background px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <Tabs tabs={tabs} value={tab} onChange={setTab} />
      </div>

      <div role="tabpanel">
        {tab === "overview" && <OverviewTab labour={labour} />}

        {tab === "attendance" && isBigari && <AttendanceTab records={getAttendance(labour.id)} />}

        {tab === "work" && isMaapvali && <MaapWorkHistoryCard worker={labour} />}
        {tab === "work" && isPatlavale && <TeamProductionCard team={labour} />}

        {tab === "payments" &&
          (isPatlavale ? (
            // Season production stays in view on the Payments tab: payments never change it.
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-surface p-4 sm:p-5">
                <ProductionSummary
                  scope="Not changed by payments"
                  summary={{
                    totalPhysicalBricks: labour.totalPhysicalBricks,
                    totalPayableBricks: labour.totalPayableBricks,
                    totalMaaps: labour.totalMaaps,
                    totalEarnings: labour.earned,
                  }}
                />
              </div>
              {payments}
            </div>
          ) : (
            payments
          ))}

        {tab === "rate-history" && (
          <RateHistoryTab labour={labour} history={rateHistory} onChangeRate={isBigari ? () => setRateOpen(true) : undefined} />
        )}
      </div>

      <EditLabourModal
        labour={editOpen ? labour : null}
        onClose={() => setEditOpen(false)}
        isMobileTaken={(mobile) => isMobileTaken(mobile, labour.id)}
        onSubmit={handleEdit}
      />

      {isBigari && (
        <ChangeRateModal
          open={rateOpen}
          onClose={() => setRateOpen(false)}
          currentRate={labour.dailyRate}
          latestEffectiveFrom={rateHistory[0].effectiveFrom}
          onSubmit={handleRateChange}
        />
      )}

      <ConfirmDialog
        open={toggleOpen}
        variant={isActive ? "danger" : "primary"}
        title="Change status?"
        message={
          isActive
            ? `${labour.name} will be marked inactive. All attendance, work entries, payments and balance are kept, and you can reactivate them anytime.`
            : `${labour.name} will be marked active again.`
        }
        confirmText={isActive ? "Mark inactive" : "Mark active"}
        onConfirm={handleToggleConfirm}
        onCancel={() => setToggleOpen(false)}
      />
    </div>
  );
}
