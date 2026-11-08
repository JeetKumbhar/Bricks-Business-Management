import { useEffect, useState } from "react";
import { PrintCopy } from "./InvoicePreview";

/** Print only the invoice: the app is hidden by the print stylesheet while body.inv-printing is set. */
export function printInvoice() {
  const done = () => {
    document.body.classList.remove("inv-printing");
    window.removeEventListener("afterprint", done);
    window.removeEventListener("pointerdown", done);
  };
  document.body.classList.add("inv-printing");
  window.addEventListener("afterprint", done);
  window.addEventListener("pointerdown", done, { once: true }); // safety net: the app can never stay hidden
  window.print();
}

/**
 * Print or download a bill that is not open on screen (for example from the list): `print(bill)` mounts the hidden print
 * copy, prints it, and removes it when the print dialog closes. Render `host` once in the page.
 */
export function usePrintBill() {
  const [job, setJob] = useState(null);
  useEffect(() => {
    if (!job) return undefined;
    const t = setTimeout(printInvoice, 250); // let the print copy mount first
    const clear = () => setJob(null);
    window.addEventListener("afterprint", clear);
    return () => {
      clearTimeout(t);
      window.removeEventListener("afterprint", clear);
    };
  }, [job]);
  return { print: (bill) => setJob({ bill }), host: job ? <PrintCopy bill={job.bill} /> : null };
}
