import * as service from "../services/settlementPayment.service.js";
import { sendSuccess } from "../utils/apiResponse.js";

export const getSettlement = async (req, res) => sendSuccess(res, { message: "Settlement fetched successfully", data: await service.getSettlementWithProgress(req.params.id) });
export const settlementPayment = async (req, res) => {
  const { replayed, ...data } = await service.recordSettlementPayment(req.params.id, req.params.statementId, req.body, req.user);
  return sendSuccess(res, { statusCode: replayed ? 200 : 201, message: replayed ? "This request was already recorded; the first payment is returned" : "Settlement payment recorded", data: { replayed, ...data } });
};
export const carryForward = async (req, res) => {
  const { replayed, ...data } = await service.recordCarryForwardDecision(req.params.id, req.params.statementId, req.body, req.user);
  return sendSuccess(res, { statusCode: replayed ? 200 : 201, message: replayed ? "This decision was already recorded" : "Carry-forward decision recorded. Nothing was deducted, paid or written off", data: { replayed, ...data } });
};
