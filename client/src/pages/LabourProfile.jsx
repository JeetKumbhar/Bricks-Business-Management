import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Users } from "lucide-react";
import { Button, ConfirmDialog, EmptyState, Tabs, useToast } from "../components/ui";
import EditLabourModal from "../features/labours/EditLabourModal";
import AttendanceTab from "../features/labours/profile/AttendanceTab";
import ChangeRateModal from "../features/labours/profile/ChangeRateModal";
import OverviewTab from "../features/labours/profile/OverviewTab";
import PaymentsTab from "../features/labours/profile/PaymentsTab";
import ProfileHeader from "../features/labours/profile/ProfileHeader";
import RateHistoryTab from "../features/labours/profile/RateHistoryTab";
import useLabours from "../features/labours/useLabours";
import { formatCurrency } from "../utils/formatCurrency";
import { formatDate } from "../utils/formatDate";
import { LABOUR_STATUS } from "../utils/labourStatus";

const TAB_IDS = ["overview", "attendance", "payments", "rate-history"];
const TABS = [
  { id: "overview", label: "Overview" },
  { id: "attendance", label: "Attendance" },
  { id: "payments", label: "Payments" },
  { id: "rate-history", label: "Rate History" },
];

export default function LabourProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const { getLabour, getAttendance, getPayments, getRateHistory, updateLabour, isMobileTaken, changeRate } = useLabours();

  const [editOpen, setEditOpen] = useState(false);
  const [toggleOpen, setToggleOpen] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);

  const labour = getLabour(id);
  const requestedTab = params.get("tab");
  const tab = TAB_IDS.includes(requestedTab) ? requestedTab : "overview";
  const setTab = (next) => setParams(next === "overview" ? {} : { tab: next }, { replace: true });

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

  const rateHistory = getRateHistory(labour.id);
  const isActive = labour.status === LABOUR_STATUS.ACTIVE;

  const handleEdit = (labourId, values) => {
    const changes = { ...values };
    delete changes.dailyRate; // the rate changes only through Rate History
    updateLabour(labourId, changes);
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

  return (
    <div className="space-y-4">
      <Link to="/labours" className="inline-flex items-center gap-1.5 py-1 text-sm font-medium text-primary">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Labour list
      </Link>

      <ProfileHeader labour={labour} onEdit={() => setEditOpen(true)} onToggleStatus={() => setToggleOpen(true)} />

      {/* Sticks under the header while the tab content scrolls (matches main padding so it spans edge to edge) */}
      <div className="sticky top-16 z-20 -mx-4 bg-background px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <Tabs tabs={TABS} value={tab} onChange={setTab} />
      </div>

      <div role="tabpanel">
        {tab === "overview" && <OverviewTab labour={labour} />}
        {tab === "attendance" && <AttendanceTab records={getAttendance(labour.id)} />}
        {tab === "payments" && <PaymentsTab labour={labour} payments={getPayments(labour.id)} />}
        {tab === "rate-history" && (
          <RateHistoryTab labour={labour} history={rateHistory} onChangeRate={() => setRateOpen(true)} />
        )}
      </div>

      <EditLabourModal
        labour={editOpen ? labour : null}
        onClose={() => setEditOpen(false)}
        isMobileTaken={(mobile) => isMobileTaken(mobile, labour.id)}
        onSubmit={handleEdit}
      />

      <ChangeRateModal
        open={rateOpen}
        onClose={() => setRateOpen(false)}
        currentRate={labour.dailyRate}
        latestEffectiveFrom={rateHistory[0].effectiveFrom}
        onSubmit={handleRateChange}
      />

      <ConfirmDialog
        open={toggleOpen}
        variant={isActive ? "danger" : "primary"}
        title={isActive ? "Mark labour as inactive?" : "Mark labour as active?"}
        message={
          isActive
            ? `${labour.name} will be marked inactive. All attendance, payments and balance are kept, and you can reactivate them anytime.`
            : `${labour.name} will be marked active again.`
        }
        confirmText={isActive ? "Mark inactive" : "Mark active"}
        onConfirm={handleToggleConfirm}
        onCancel={() => setToggleOpen(false)}
      />
    </div>
  );
}
