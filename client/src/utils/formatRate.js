import { formatCurrency } from "./formatCurrency";
import { LABOUR_TYPE_META } from "./labourTypes";

/** The rate of a labour record, read from the field that belongs to its type. */
export const getRate = (worker) => worker[LABOUR_TYPE_META[worker.labourType].rateField];

/** "₹650 / day", "₹22 / maap", "₹650 / 1,000 bricks" */
export const formatRate = (worker) =>
  `${formatCurrency(getRate(worker))} ${LABOUR_TYPE_META[worker.labourType].rateUnitShort}`;
