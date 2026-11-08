import "./invoicePrint.css";
import { amountInWords } from "../../utils/amountInWords";
import { splitRsP } from "../../utils/money";
import { BILL_STATUS } from "./billModel";
import { billTotals } from "./billSelectors";
import { addressParts, billNumberText, INVOICE_COLUMNS, invoiceDate, invoiceSeller, phoneList, quantityText, rateText, taxRows } from "./invoiceFormat";
import { paginateItems } from "./invoicePages";

const Money = ({ paise }) => {
  const { rs, p } = splitRsP(paise);
  return (
    <>
      <td className="num">{rs}</td>
      <td className="num">{p}</td>
    </>
  );
};

/** One A4 page of the invoice. `last` pages carry the totals, bank details, amount in words and signature. */
function InvoicePage({ bill, rows, startIndex, pageNumber, pageCount, totals }) {
  const { customer } = bill;
  const { seller, bank } = invoiceSeller(bill);
  const last = pageNumber === pageCount;
  const phones = phoneList(seller.phones);
  const addr = addressParts(seller.address);
  const taxes = taxRows(totals);
  const mark = bill.status === BILL_STATUS.DRAFT ? "DRAFT" : bill.status === BILL_STATUS.CANCELLED ? "CANCELLED" : "";

  return (
    <section className="inv-page inv-sheet" aria-label={`Tax invoice ${billNumberText(bill) || "draft"}, page ${pageNumber} of ${pageCount}`}>
      {mark && <div className="inv-mark" aria-hidden="true">{mark}</div>}

      <header className="inv-head">
        <div className="inv-juris">{seller.jurisdiction && `Subject to ${seller.jurisdiction}`}</div>
        <div className="inv-mob">
          {phones.length > 0 && `Mob. : ${phones[0]}`}
          {phones.slice(1).map((p) => (
            <div key={p} style={{ paddingLeft: "3.2em" }}>{p}</div>
          ))}
        </div>
        <div className="inv-taxinv">TAX INVOICE</div>
        <div className="inv-name">{seller.name}</div>
        <div className="inv-desc">{seller.description}</div>
        <div className="inv-products">{seller.productLine}</div>
        <div className="inv-address">
          <b>{addr.head}</b>
          {addr.rest}
        </div>
      </header>
      <div className="inv-rule" />
      <div className="inv-ids">
        <span>GSTIN : {seller.gstin}</span>
        <span>PAN No : {seller.pan}</span>
      </div>

      <div className="inv-party">
        <div className="inv-party-left">
          <div className="inv-ms">
            <span>M/s.</span>
            <span className="inv-line inv-val">{customer.name}</span>
          </div>
          <div className="inv-line inv-addr inv-val">{customer.address}</div>
          <div className="inv-gstrow">
            <span>GSTIN :</span>
            <span className="inv-line inv-val">{customer.gstin}</span>
            <span>State Code :</span>
            <span className="inv-line short inv-val">{customer.stateCode}</span>
          </div>
        </div>
        <div className="inv-party-right">
          <div className="inv-box">
            <span>Bill No. :</span>
            <span className="inv-val">{billNumberText(bill)}</span>
          </div>
          <div className="inv-box">
            <span>Bill Date :</span>
            <span className="inv-val">{invoiceDate(bill.billDate)}</span>
          </div>
        </div>
      </div>

      <div className="inv-tablewrap">
        <table className="inv-table">
          <colgroup>
            {INVOICE_COLUMNS.map((w, i) => (
              <col key={i} style={{ width: `${w * 100}%` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={2}>Sr.<br />No.</th>
              <th rowSpan={2}>PARTICULARS</th>
              <th rowSpan={2}>HSN/SAC<br />Code</th>
              <th rowSpan={2}>Quantity</th>
              <th rowSpan={2}>Rate</th>
              <th colSpan={2}>AMOUNT</th>
            </tr>
            <tr>
              <th>Rs.</th>
              <th>P.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item, i) => (
              <tr key={startIndex + i}>
                <td className="ctr">{startIndex + i + 1}</td>
                <td>{item.particulars}</td>
                <td className="ctr">{item.hsn}</td>
                <td className="num">{quantityText(item)}</td>
                <td className="num">{rateText(item)}</td>
                <Money paise={totals.lines[startIndex + i].amountPaise} />
              </tr>
            ))}
            <tr className="inv-fill">
              {INVOICE_COLUMNS.map((_, i) => (
                <td key={i} />
              ))}
            </tr>
          </tbody>
          <tfoot>
            {last ? (
              <tr>
                <td colSpan={4} className="inv-blank" />
                <td>TOTAL</td>
                <Money paise={totals.taxablePaise} />
              </tr>
            ) : (
              <tr>
                <td colSpan={7} className="inv-cont">Continued on next page...</td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>

      {last && (
        <>
          <div className="inv-foot">
            <div className="inv-bank">
              <div className="inv-bank-label">BANK DETAILS</div>
              <dl>
                <dt>Bank Name</dt>
                <dd>: {bank.name}</dd>
                <dt>Branch</dt>
                <dd>: {bank.branch}</dd>
                <dt>Account No.</dt>
                <dd>: {bank.accountNumber}</dd>
                <dt>IFSC Code</dt>
                <dd>: {bank.ifsc}</dd>
              </dl>
            </div>
            <div className="inv-taxes">
              {/* the block always keeps four rows, like the bill book: blank form lines where a tax does not apply */}
              {Array.from({ length: 3 - taxes.length }, (_, i) => (
                <div className="inv-trow" key={`blank-${i}`} aria-hidden="true">
                  <span className="l" />
                  <span className="r" />
                  <span className="p" />
                </div>
              ))}
              {taxes.map((t) => {
                const { rs, p } = splitRsP(t.paise);
                return (
                  <div className="inv-trow" key={t.key}>
                    <span className="l">{t.label}</span>
                    <span className="r">{rs}</span>
                    <span className="p">{p}</span>
                  </div>
                );
              })}
              <div className="inv-trow">
                <span className="l">GRAND TOTAL</span>
                <span className="r">{splitRsP(totals.grandPaise).rs}</span>
                <span className="p">{splitRsP(totals.grandPaise).p}</span>
              </div>
            </div>
          </div>
          <div className="inv-sign">
            <div className="inv-words">
              Amount in Words
              <span className="inv-line inv-val">{amountInWords(totals.grandPaise)}</span>
            </div>
            <div className="inv-for">
              <span>
                For <b>{seller.name}</b>
              </span>
              <span>{seller.signatoryTitle}</span>
            </div>
          </div>
        </>
      )}
      {pageCount > 1 && <div className="inv-pageno">Page {pageNumber} of {pageCount}</div>}
    </section>
  );
}

/**
 * The whole invoice: one or more A4 pages. `bill` = { billNumber, billDate, status, customer, items, taxMode, seller } (the backend field names).
 * The totals are calculated here from the items (never taken from a typed or stored total).
 */
export default function InvoiceDocument({ bill }) {
  const totals = billTotals(bill);
  const pages = paginateItems(bill.items);
  const starts = pages.map((_, i) => pages.slice(0, i).reduce((n, rows) => n + rows.length, 0)); // index of each page's first row
  return (
    <div className="inv-pages">
      {pages.map((rows, i) => (
        <InvoicePage key={i} bill={bill} rows={rows} startIndex={starts[i]} pageNumber={i + 1} pageCount={pages.length} totals={totals} />
      ))}
    </div>
  );
}
