import { LABOUR_TYPES } from "../constants/labour.js";
import { PAYMENT_TYPES, RECIPIENT_TYPES } from "../constants/payments.js";
import Labour from "../models/Labour.js";
import Payment from "../models/Payment.js";
import Season from "../models/Season.js";
import SeasonSettlement from "../models/SeasonSettlement.js";
import SettlementDecision from "../models/SettlementDecision.js";
import SettlementLock from "../models/SettlementLock.js";
import SettlementStatement from "../models/SettlementStatement.js";
import ApiError from "../utils/ApiError.js";
import { paiseToRupees, rupeesToPaise, sumPaise } from "../utils/money.js";
import { runInTransaction } from "../utils/transaction.js";
import { checkRecipientRules, core, toDetailDto, toPaymentDto } from "./payment.service.js";
import { getSettlement } from "./settlement.service.js";

// Settlement payments and carry-forward decisions (S3). Kept apart from the season and production modules: they never import anything payment-related.

const fieldError = (status, message, field) => new ApiError(status, message, [{ field, message }]);
const isDuplicateKey = (err) => err?.code === 11000;
const inSession = (query, session) => (session ? query.session(session) : query);

// ---------- Settlement status (derived; nothing here is stored or editable) ----------
// remaining payable = the immutable statement's payable - the LIVE settlement payments linked to that statement. A voided payment is left out,
// so voiding one reopens the balance. A negative closing balance is never paid, deducted or written off: it stays a recorded decision away from resolved.

export const SETTLEMENT_STATUS = Object.freeze({ SETTLED: "SETTLED", PARTIALLY_SETTLED: "PARTIALLY_SETTLED", OUTSTANDING: "OUTSTANDING", PENDING_DECISION: "PENDING_DECISION", CARRIED_FORWARD: "CARRIED_FORWARD" });
const RESOLVED = new Set([SETTLEMENT_STATUS.SETTLED, SETTLEMENT_STATUS.CARRIED_FORWARD]);

/** One worker's settlement progress from the stored statement, every payment linked to it (voided ones included for history) and the decision, if any. */
export const progressOf = (statement, payments, decision) => {
  const live = payments.filter((p) => !p.isDeleted);
  const paidPaise = sumPaise(live.map((p) => p.amountPaise));
  const payablePaise = statement.payablePaise ?? 0;
  const remainingPaise = statement.status === "PAYABLE" ? payablePaise - paidPaise : 0;
  let status;
  if (statement.status === "RECOVERABLE") status = decision ? SETTLEMENT_STATUS.CARRIED_FORWARD : SETTLEMENT_STATUS.PENDING_DECISION;
  else if (statement.status === "ZERO") status = SETTLEMENT_STATUS.SETTLED;
  else if (remainingPaise <= 0) status = SETTLEMENT_STATUS.SETTLED;
  else status = paidPaise > 0 ? SETTLEMENT_STATUS.PARTIALLY_SETTLED : SETTLEMENT_STATUS.OUTSTANDING;
  return {
    statementId: String(statement._id),
    labourId: statement.labourId,
    name: statement.name,
    statementStatus: statement.status,
    status,
    payablePaise,
    paidPaise,
    remainingPaise,
    payable: paiseToRupees(payablePaise),
    paid: paiseToRupees(paidPaise),
    remaining: paiseToRupees(remainingPaise),
    recoverablePaise: statement.recoverablePaise ?? 0,
    recoverable: paiseToRupees(statement.recoverablePaise ?? 0),
    decision: decision ? toDecisionDto(decision) : null,
    payments: [...payments].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).map(toPaymentDto),
  };
};

export const toDecisionDto = (row) => ({
  id: String(row._id),
  statementId: row.statementId,
  settlementId: row.settlementId,
  seasonId: row.seasonId,
  labourId: row.labourId,
  kind: row.kind,
  amountPaise: row.amountPaise,
  amount: paiseToRupees(row.amountPaise),
  reason: row.reason,
  ledgerDate: row.ledgerDate,
  decidedAt: row.decidedAt,
  decidedBy: row.decidedBy,
});

/** The season-level view: it is fully settled only when every payable is zero AND every negative balance has an explicit decision. */
export const summarizeProgress = (items) => {
  const count = (st) => items.filter((i) => i.status === st).length;
  const remainingPaise = sumPaise(items.map((i) => i.remainingPaise));
  const paidPaise = sumPaise(items.map((i) => i.paidPaise));
  const pendingDecisions = count(SETTLEMENT_STATUS.PENDING_DECISION);
  const fullySettled = items.every((i) => RESOLVED.has(i.status));
  let status;
  if (fullySettled) status = SETTLEMENT_STATUS.SETTLED;
  else if (remainingPaise > 0) status = paidPaise > 0 ? SETTLEMENT_STATUS.PARTIALLY_SETTLED : SETTLEMENT_STATUS.OUTSTANDING;
  else status = SETTLEMENT_STATUS.PENDING_DECISION;
  return {
    status,
    fullySettled,
    workers: items.length,
    settled: count(SETTLEMENT_STATUS.SETTLED),
    partiallySettled: count(SETTLEMENT_STATUS.PARTIALLY_SETTLED),
    outstanding: count(SETTLEMENT_STATUS.OUTSTANDING),
    pendingDecisions,
    carriedForward: count(SETTLEMENT_STATUS.CARRIED_FORWARD),
    paidPaise,
    remainingPaise,
    paid: paiseToRupees(paidPaise),
    remaining: paiseToRupees(remainingPaise),
  };
};

const loadClosed = async (seasonId, statementId, session = null) => {
  const [season] = await inSession(Season.find({ _id: seasonId }), session).lean();
  if (!season) throw ApiError.notFound("Season not found");
  const [settlement] = await inSession(SeasonSettlement.find({ seasonId: String(season._id) }), session).lean();
  if (!settlement) throw ApiError.notFound("This season has no settlement record (it has not been closed through the settlement process)");
  const [statement] = await inSession(SettlementStatement.find({ _id: statementId }), session).lean();
  if (!statement || statement.seasonId !== String(season._id)) throw ApiError.notFound("This worker's closing statement was not found in this season");
  return { season, settlement, statement };
};

/** Every payment linked to one statement (live and voided). */
const paymentsOf = async (statementId, session = null) => inSession(Payment.find({ statementId }), session).lean();

/**
 * POST /api/seasons/:id/statements/:statementId/payments  { amount, paidOn, method?, reference?, note?, requestId }.
 * Records ONE actual final payment against a worker's immutable closing statement, as a SALARY_PAYMENT through the same Payment collection.
 *  - `date` (the ledger date) is the season end date, so the season's books balance; `paidOn` is the day the money was really paid.
 *  - A partial payment is fine; an amount above the remaining payable is refused (409). Two payments for the same worker cannot run at once: each
 *    one first bumps the worker's SettlementLock (a write inside the transaction), so the second waits or retries and then sees the first.
 *  - requestId is required. The same requestId + same details returns the first payment (200, replayed: true); different details are refused (409).
 *  - Nothing else is written: the statement, attendance, production, Bayana and every earlier payment stay unchanged.
 */
export const recordSettlementPayment = async (seasonId, statementId, input, actor, now = new Date()) => {
  const amountPaise = rupeesToPaise(input.amount);
  const requestId = input.requestId;

  const attempt = () =>
    runInTransaction(
      async (session) => {
        const { settlement, statement } = await loadClosed(seasonId, statementId, session);
        if (statement.status !== "PAYABLE") {
          throw fieldError(409, statement.status === "RECOVERABLE" ? `${statement.name} was paid more than they earned. There is nothing to pay; record a carry-forward decision instead.` : `${statement.name} has nothing payable in this season.`, "statementId");
        }
        const [labour] = await inSession(Labour.find({ _id: statement.labourId }), session).lean();
        if (!labour) throw fieldError(400, "Recipient not found", "recipientId");
        checkRecipientRules({ labour, type: PAYMENT_TYPES.SALARY_PAYMENT, date: input.paidOn, note: input.note ?? "", now });
        if (input.paidOn < settlement.endDate) throw fieldError(400, `A final settlement cannot be paid before the season ended (${settlement.endDate}).`, "paidOn");

        const candidate = { recipientId: statement.labourId, type: PAYMENT_TYPES.SALARY_PAYMENT, amountPaise, date: settlement.endDate };
        const replay = async () => {
          const [first] = await inSession(Payment.find({ requestId }), session).lean();
          if (!first) return null;
          if (core(first) !== core(candidate) || first.statementId !== statementId || first.paidOn !== input.paidOn) throw fieldError(409, "This requestId was already used for a different payment", "requestId");
          return { paymentRow: first, replayed: true };
        };

        // Serialise payments for this worker BEFORE reading what is already paid.
        await SettlementLock.updateOne(
          { statementId },
          { $inc: { version: 1 }, $setOnInsert: { seasonId: statement.seasonId, settlementId: statement.settlementId, labourId: statement.labourId } },
          session ? { upsert: true, session } : { upsert: true }
        );
        const again = await replay();
        if (again) return again;

        const paidPaise = sumPaise((await paymentsOf(statementId, session)).filter((p) => !p.isDeleted).map((p) => p.amountPaise));
        const remainingPaise = statement.payablePaise - paidPaise;
        if (amountPaise > remainingPaise) {
          throw fieldError(409, remainingPaise <= 0 ? `${statement.name}'s final settlement is already fully paid.` : `This is more than the remaining payable. ${paiseToRupees(remainingPaise)} is left to pay.`, "amount");
        }

        const actorId = actor?.id ?? null;
        const doc = {
          ...candidate,
          recipientType: labour.labourType === LABOUR_TYPES.PATLAVALE ? RECIPIENT_TYPES.TEAM : RECIPIENT_TYPES.WORKER,
          method: input.method ?? "CASH",
          reference: input.reference ?? "",
          note: input.note || `Final settlement: ${settlement.seasonName}`,
          paidOn: input.paidOn,
          seasonId: statement.seasonId,
          settlementId: statement.settlementId,
          statementId,
          requestId,
          revision: 1,
          history: [],
          isDeleted: false,
          createdBy: actorId,
          updatedBy: actorId,
        };
        const [created] = await Payment.create([doc], session ? { session } : undefined);
        return { paymentRow: created.toObject({ transform: false }), replayed: false };
      },
      { required: true }
    );

  let result;
  try {
    result = await attempt();
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    // Two first-time requests raced (the lock record, or the same requestId). Run once more: it now sees the winner and either replays or checks the balance.
    result = await attempt();
  }
  return { payment: toDetailDto(result.paymentRow), replayed: result.replayed, ...(await getSettlementWithProgress(seasonId)) };
};

/**
 * POST /api/seasons/:id/statements/:statementId/carry-forward  { reason, confirm: true }.
 * The Owner's explicit decision that a worker's negative closing balance (paid more than earned) stays an outstanding advance, to be carried into whatever comes next.
 * It records the decision and nothing else: no deduction, no payment, no write-off, and the statement still shows the original negative amount. Written once per statement.
 */
export const recordCarryForwardDecision = async (seasonId, statementId, input, actor, now = new Date()) => {
  const existing = async (session) => (await inSession(SettlementDecision.find({ statementId }), session).lean())[0] ?? null;
  const sameDecision = (row) => row.reason === input.reason;
  let replayed = false;
  try {
    await runInTransaction(
      async (session) => {
        const { settlement, statement } = await loadClosed(seasonId, statementId, session);
        if (statement.status !== "RECOVERABLE") throw fieldError(409, `${statement.name} does not have a negative balance, so there is nothing to carry forward.`, "statementId");
        const found = await existing(session);
        if (found) {
          if (!sameDecision(found)) throw fieldError(409, "A carry-forward decision was already recorded for this worker with a different reason. It cannot be changed.", "reason");
          replayed = true;
          return;
        }
        await SettlementDecision.insertMany(
          [
            {
              seasonId: statement.seasonId,
              settlementId: statement.settlementId,
              statementId,
              labourId: statement.labourId,
              kind: "CARRY_FORWARD",
              amountPaise: statement.recoverablePaise,
              reason: input.reason,
              decidedAt: now,
              decidedBy: { id: actor?.id ?? null, name: actor?.name ?? null },
              ledgerDate: settlement.endDate,
            },
          ],
          session ? { session } : undefined
        );
      },
      { required: true }
    );
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    const found = await existing(null); // two copies raced: the loser reports the winner's decision
    if (!found || !sameDecision(found)) throw fieldError(409, "A carry-forward decision was already recorded for this worker with a different reason. It cannot be changed.", "reason");
    replayed = true;
  }
  const decision = await existing(null);
  return { decision: toDecisionDto(decision), replayed, ...(await getSettlementWithProgress(seasonId)) };
};


/** The S2 settlement (statements untouched) plus the derived settlement progress. Reads only. */
export const getSettlementWithProgress = async (seasonId) => {
  const base = await getSettlement(seasonId);
  const [payments, decisions] = await Promise.all([Payment.find({ seasonId }).lean(), SettlementDecision.find({ seasonId }).lean()]);
  const statements = (await SettlementStatement.find({ seasonId }).lean()).sort((a, b) => a.labourId.localeCompare(b.labourId));
  const progress = statements.map((st) => progressOf(st, payments.filter((p) => p.statementId === String(st._id)), decisions.find((d) => d.statementId === String(st._id))));
  return { ...base, progress, summary: summarizeProgress(progress) };
};
