export const filterPayments = (payments, { search = "", type = "ALL" }) => {
  const q = search.trim().toLowerCase();
  return payments.filter((p) => {
    if (type !== "ALL" && p.type !== type) return false;
    if (!q) return true;
    return (
      p.labourName.toLowerCase().includes(q) ||
      p.labourId.toLowerCase().includes(q) ||
      (p.note ?? "").toLowerCase().includes(q)
    );
  });
};

export const sumAmount = (payments) => payments.reduce((total, p) => total + p.amount, 0);

/** Total of payments dated on or after `fromDate` ("YYYY-MM-DD"). */
export const sumSince = (payments, fromDate) => sumAmount(payments.filter((p) => p.date >= fromDate));
