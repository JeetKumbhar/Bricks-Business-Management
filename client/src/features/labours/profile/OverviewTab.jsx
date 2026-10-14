import { LABOUR_TYPES } from "../../../utils/labourTypes";
import AccountSummaryCard from "../../accounts/AccountSummaryCard";
import AttendanceStatsCard from "./AttendanceStatsCard";
import FinancialSummaryCard from "./FinancialSummaryCard";
import LabourDetailsCard from "./LabourDetailsCard";
import MaapStatsCard from "./MaapStatsCard";
import ProductionStatsCard from "./ProductionStatsCard";

/**
 * Details + work totals + account, matched to the labour type:
 *  Bigari: attendance counts   Maapvali: maap totals   Patlavale: season production
 */
export default function OverviewTab({ labour }) {
  const type = labour.labourType;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <LabourDetailsCard labour={labour} />
      <div className="space-y-4 lg:col-span-2">
        {type === LABOUR_TYPES.BIGARI && <AttendanceStatsCard labour={labour} />}
        {type === LABOUR_TYPES.MAAPVALI && <MaapStatsCard labour={labour} />}
        {type === LABOUR_TYPES.PATLAVALE && <ProductionStatsCard labour={labour} />}

        {type === LABOUR_TYPES.BIGARI ? <FinancialSummaryCard labour={labour} /> : <AccountSummaryCard worker={labour} />}
      </div>
    </div>
  );
}
