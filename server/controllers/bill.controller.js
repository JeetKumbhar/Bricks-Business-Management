import * as bills from "../services/bill.service.js";
import * as billTrips_ from "../services/billTrips.service.js";
import { renderInvoicePdf } from "../services/billPdf.service.js";
import { sendSuccess } from "../utils/apiResponse.js";

export const list = async (req, res) => {
  const { items, meta } = await bills.listBills(req.query);
  return sendSuccess(res, { message: "Bills fetched successfully", data: items, meta });
};
export const getOne = async (req, res) => sendSuccess(res, { message: "Bill fetched successfully", data: await bills.getBill(req.params.id) });
export const history = async (req, res) => sendSuccess(res, { message: "Bill history fetched successfully", data: await bills.getBillHistory(req.params.id) });
export const create = async (req, res) => sendSuccess(res, { statusCode: 201, message: "Draft bill saved", data: await bills.createDraft(req.body, req.user) });
export const update = async (req, res) => sendSuccess(res, { message: "Draft bill updated", data: await bills.updateDraft(req.params.id, req.body, req.user) });
export const finalize = async (req, res) => sendSuccess(res, { message: "Bill finalized", data: await bills.finalizeBill(req.params.id, req.body, req.user) });
export const cancel = async (req, res) => sendSuccess(res, { message: "Bill cancelled", data: await bills.cancelBill(req.params.id, req.body, req.user) });
export const discard = async (req, res) => sendSuccess(res, { message: "Draft bill discarded", data: await bills.discardDraft(req.params.id, req.body ?? {}, req.user) });
export const correct = async (req, res) => sendSuccess(res, { statusCode: 201, message: "New draft created from the cancelled bill", data: await bills.correctionDraft(req.params.id, req.user) });

export const fromTrips = async (req, res) => {
  const { bill, duplicate } = await billTrips_.generateFromTrips(req.body, req.user);
  return sendSuccess(res, { statusCode: duplicate ? 200 : 201, message: duplicate ? "This draft bill was already created" : "Draft bill created from Pheeras", data: bill, meta: { duplicate } });
};
export const billTrips = async (req, res) => sendSuccess(res, { message: "Pheeras of the bill fetched successfully", data: await billTrips_.listBillTrips(req.params.id) });
export const addTrips = async (req, res) => sendSuccess(res, { message: "Pheeras added to the draft bill", data: await billTrips_.addTrips(req.params.id, req.body, req.user) });
export const removeTrip = async (req, res) => sendSuccess(res, { message: "Pheera removed from the draft bill", data: await billTrips_.removeTrip(req.params.id, req.params.tripId, req.user) });

export const pdf = async (req, res) => {
  const bill = await bills.getBillForPdf(req.params.id);
  const buffer = await renderInvoicePdf(bill);
  const name = `Invoice-${String(bill.billNumber).replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${req.query.download === "1" ? "attachment" : "inline"}; filename="${name}"`);
  res.setHeader("Cache-Control", "no-store"); // the invoice carries bank details
  return res.send(buffer);
};
