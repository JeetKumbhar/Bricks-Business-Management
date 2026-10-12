import { LABOUR_TYPE_META } from "../../utils/labourTypes";
import { getRate } from "../../utils/formatRate";

/**
 * Form values -> input for addLabour().
 * The single `rate` goes into the field that belongs to the chosen type, and nowhere else.
 */
export const toLabourInput = ({ rate, ...rest }) => ({
  ...rest,
  [LABOUR_TYPE_META[rest.labourType].rateField]: rate,
});

/** Labour record -> default values for the Edit form (the rate is shown as text). */
export const toFormValues = (labour) => ({
  labourType: labour.labourType,
  name: labour.name,
  mobile: labour.mobile,
  village: labour.village,
  joiningDate: labour.joiningDate,
  rate: String(getRate(labour)),
  status: labour.status,
});
