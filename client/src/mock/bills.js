// Demo bills + invoice settings (frontend mock phase). Replaced by API data later (see services/billService.js).
// Every record here has isDemo: true so the screens can tell sample data from bills a user creates in the browser.
// Dates are relative to today (IST) so the list always looks current. All amounts and customers are made-up samples.
//
// NO real business detail (GSTIN, PAN, bank account, phone numbers, address) is kept in this file. The owner enters those in
// Settings > Invoice / Business Details (and, once the API is connected, they are stored by the server). Until then the
// seller block of a sample invoice is simply empty. Only the business name and the state (needed so sample bills can show
// CGST + SGST or IGST) are filled in.
import { addDaysISO } from "../utils/formatDate";
import { todayBusinessDate } from "../utils/businessDate";
import { sellerSnapshot } from "../features/bills/billContract";
import { allocateBillNumber, DEFAULT_NUMBERING } from "../features/bills/billNumbering";
import { BILL_STATUS, TAX_MODE, UNIT_OPTIONS } from "../features/bills/billModel";

const SAMPLE_STATE = "Dadra & Nagar Haveli and Daman & Diu";

/** Same shape as GET /api/invoice-settings. Details the owner has not entered yet are empty. */
export const initialInvoiceSettings = {
  businessName: "AAYUSH CARTING",
  businessDescription: "",
  productsLine: "",
  gstin: "",
  pan: "",
  address: "",
  phones: [],
  jurisdiction: "",
  stateName: SAMPLE_STATE,
  stateCode: "26",
  bank: { bankName: "", branch: "", accountNumber: "", ifsc: "" },
  proprietorName: "",
  numbering: { ...DEFAULT_NUMBERING },
  defaultTaxMode: TAX_MODE.GST,
  allowedTaxRates: [], // empty = any rate from 0 to 100 (no tax rate is assumed: the user sets it per item)
  units: [...UNIT_OPTIONS],
  revision: 0,
};

const customer = (name, address, gstin, stateName, stateCode, contact) => ({ name, address, gstin, stateName, stateCode, contact });
const item = (particulars, hsn, quantity, unit, rate, taxRate) => ({ particulars, hsn, quantity, unit, rate, taxRate });

function generate() {
  const today = todayBusinessDate();
  const s = initialInvoiceSettings;
  const seller = sellerSnapshot(s);

  // oldest first, so the numbers (0001, 0002 ...) follow the dates
  const specs = [
    { ago: 12, status: BILL_STATUS.FINAL, taxMode: TAX_MODE.GST, customer: customer("Shree Ganesh Constructions", "Plot 14, Amli Industrial Estate, Silvassa", "26AABCS1234F1Z5", SAMPLE_STATE, "26", "9898012345"),
      items: [item("Bricks", "6901", 5000, "Bricks", 8, 5), item("Sand", "2505", 2, "Tonnes", 1500, 5), item("Stone", "2517", 1, "Tonnes", 2000, 5)] },
    { ago: 8, status: BILL_STATUS.FINAL, taxMode: TAX_MODE.GST, customer: customer("Maruti Builders", "GIDC Char Rasta, Vapi, Gujarat", "24AAACM5678K1Z2", "Gujarat", "24", "9825567890"),
      items: [item("Bricks", "6901", 12000, "Bricks", 7.5, 5), item("Khadi Matti", "2508", 6, "Tonnes", 900, 5)] },
    { ago: 6, status: BILL_STATUS.CANCELLED, taxMode: TAX_MODE.GST, cancelReason: "Wrong customer name entered, a new bill was made", customer: customer("Om Sai Developers", "Khanvel, Silvassa", "", SAMPLE_STATE, "26", ""),
      items: [item("Hard Murram", "2517", 4, "Tonnes", 650, 5)] },
    { ago: 3, status: BILL_STATUS.FINAL, taxMode: TAX_MODE.NON_GST, customer: customer("Ramesh Patel", "Rakholi, Silvassa", "", SAMPLE_STATE, "26", "9924001122"),
      items: [item("Soil", "", 4, "Tonnes", 700, null), item("Sand", "", 3, "Tonnes", 1200, null)] },
    { ago: 1, status: BILL_STATUS.DRAFT, taxMode: TAX_MODE.GST, customer: customer("Jay Ambe Traders", "Dadra, Silvassa", "26AAFFJ4321H1ZP", SAMPLE_STATE, "26", "9879123456"),
      items: [item("Bricks", "6901", 8000, "Bricks", 8.5, 5), item("Hard Murram", "2517", 5, "Tonnes", 600, 5)] },
    { ago: 0, status: BILL_STATUS.DRAFT, taxMode: TAX_MODE.GST, customer: customer("Sunil Contractor", "Naroli Road, Silvassa", "", SAMPLE_STATE, "26", "9898777666"),
      items: [item("Grawal", "2517", 3, "Tonnes", 1100, 5), item("Stone Dust", "2517", 2, "Tonnes", 800, 5)] },
  ];

  const bills = [];
  specs.forEach((spec, i) => {
    const billDate = addDaysISO(today, -spec.ago);
    const stamp = `${billDate}T09:30:00.000Z`;
    const issued = spec.status !== BILL_STATUS.DRAFT; // drafts have no number (only finalizing allocates one)
    bills.push({
      id: `bill-demo-${i + 1}`,
      billNumber: null,
      billDate,
      status: spec.status,
      customer: spec.customer,
      items: spec.items,
      taxMode: spec.taxMode,
      notes: "",
      seller,
      revision: 1,
      isDemo: true,
      createdAt: stamp,
      updatedAt: stamp,
      ...(issued ? { ...allocateBillNumber(bills, s.numbering, billDate), finalizedAt: stamp } : {}),
      ...(spec.status === BILL_STATUS.CANCELLED ? { cancelledAt: stamp, cancelledReason: spec.cancelReason } : {}),
    });
  });
  return bills;
}

export const initialBills = generate();
