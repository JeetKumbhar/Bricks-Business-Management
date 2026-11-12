// Pure judgement of what the database holds for one Phase 4 bill and its Pheeras (used by inspectPhase4Bill.js, unit-tested).
// Business rules checked: cancelling keeps the finalized bill (number, figures, history) and leaves its Pheeras BILLED and linked,
// each with a BILL_CANCELLED note in their billing trail.
export const judgeBillState = ({ bill, trips }) => {
  const lines = [];
  const problems = [];
  const sourceTrips = trips ?? [];
  const noted = (t) => (t.billingHistory ?? []).some((h) => h.action === "BILL_CANCELLED" && String(h.billId) === String(bill._id));
  const historyActions = (bill.history ?? []).map((h) => h.action);
  let verdict;

  if (bill.status === "CANCELLED") {
    verdict = "CANCELLATION WAS APPLIED";
    if (!bill.cancelledAt || !bill.cancelledReason) problems.push("status is CANCELLED but cancelledAt / cancelledReason is missing");
    if (!historyActions.includes("CANCEL")) problems.push("no CANCEL entry in the bill history");
    if (!historyActions.includes("FINALIZE")) problems.push("the FINALIZE entry is missing from the bill history (history must be preserved)");
    for (const t of sourceTrips) {
      if (t.billingStatus !== "BILLED" || String(t.billId) !== String(bill._id)) lines.push(`Pheera ${t.pheeraNo}: ${t.billingStatus} (billId ${t.billId ?? "none"}). Expected BILLED on this bill unless it was released afterwards.`);
      if (t.billingStatus === "BILLED" && !noted(t)) problems.push(`Pheera ${t.pheeraNo} is BILLED but has no BILL_CANCELLED note: the bill update and the Pheera update were NOT saved together`);
    }
  } else if (bill.status === "FINALIZED") {
    verdict = "CANCELLATION WAS NOT APPLIED (the bill is still FINALIZED)";
    for (const t of sourceTrips) if (noted(t)) problems.push(`Pheera ${t.pheeraNo} has a BILL_CANCELLED note but the bill is still FINALIZED: only the Pheera part was saved`);
    if (historyActions.includes("CANCEL")) problems.push("a CANCEL entry exists in the bill history although the status is FINALIZED");
  } else {
    verdict = `UNEXPECTED STATUS ${bill.status}`;
    problems.push("this is not a finalized or cancelled bill");
  }
  return { verdict, lines, problems, consistent: problems.length === 0 };
};
