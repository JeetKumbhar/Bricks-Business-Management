import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { paginateItems } from "./invoicePages";
import InvoiceDocument from "./InvoiceDocument";

const PAGE_W = 794; // A4 at 96 dpi
const PAGE_H = 1123;
const GAP = 24;

/**
 * The invoice on screen. It always keeps its A4 proportions: on a narrow screen it is scaled down to fit the width
 * (the real size is used for printing and for the PDF). Also mounts the hidden print copy in #invoice-print-portal.
 */
export default function InvoicePreview({ bill }) {
  const box = useRef(null);
  const [scale, setScale] = useState(1);
  const pageCount = paginateItems(bill.items).length;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const update = () => setScale(Math.min(1, el.clientWidth / PAGE_W));
    update();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <>
      <div ref={box} className="inv-viewport" style={{ height: (pageCount * PAGE_H + (pageCount - 1) * GAP) * scale }}>
        <div className="inv-scale" style={{ transform: `scale(${scale})` }}>
          <InvoiceDocument bill={bill} />
        </div>
      </div>
      <PrintCopy bill={bill} />
    </>
  );
}

/** A second, full-size copy of the invoice in its own container outside the app (hidden on screen). */
export function PrintCopy({ bill }) {
  // the container is created once (not attached yet); it joins the page while this component is mounted
  const [host] = useState(() => {
    if (typeof document === "undefined") return null;
    const el = document.createElement("div");
    el.id = "invoice-print-portal";
    return el;
  });
  useEffect(() => {
    if (!host) return undefined;
    document.body.appendChild(host);
    return () => {
      host.remove();
    };
  }, [host]);
  return host ? createPortal(<InvoiceDocument bill={bill} />, host) : null;
}
