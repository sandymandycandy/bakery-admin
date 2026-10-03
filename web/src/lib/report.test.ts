import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSalesReport, reportRange, reportToCsv } from "./report.ts";

const labels = {
  method: { cash: "Cash", upi: "UPI" } as Record<string, string>,
  source: { IN_STORE: "In-store", CALL: "Call" } as Record<string, string>,
};

const sample = parseSalesReport({
  from: "2026-11-10",
  to: "2026-11-10",
  timezone: "Asia/Kolkata",
  summary: {
    bills: 2, gross_paise: 159000, discount_paise: 10000, billed_paise: 149000, tax_paise: 8040,
    credit_notes: 1, credited_paise: 9000, credited_tax_paise: 429, net_paise: 140000, net_tax_paise: 7611,
  },
  money: [{ method: "cash", received_paise: 99000, refunded_paise: 9050 }],
  products: [{ name: 'Cake, "Choco"', variant: "1 kg", quantity: 3, gross_paise: 150000, discount_paise: 10000, net_paise: 140000 }],
  categories: [{ name: "Cakes", quantity: 3, gross_paise: 150000, discount_paise: 10000, net_paise: 140000 }],
  sources: [{ source: "IN_STORE", bills: 1, billed_paise: 99000, credited_paise: 9000, net_paise: 90000 }],
});

test("CSV keeps commas and quotes in one column and writes rupees with two decimals", () => {
  const csv = reportToCsv(sample, labels);
  assert.ok(csv.includes('"Cake, ""Choco""",1 kg,3,1500.00,100.00,1400.00'));
  assert.ok(csv.includes("Cash,990.00,90.50,899.50"));
  assert.ok(csv.includes("In-store,1,990.00,90.00,900.00"));
  assert.ok(csv.includes("Net sales,1400.00"));
});

test("CSV sections come in a fixed order", () => {
  const csv = reportToCsv(sample, labels);
  const order = ["Sales report", "Summary", "Money", "By source", "By category", "By product"].map((h) => csv.indexOf(h));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(order.every((i) => i >= 0));
});

test("an empty or partial report parses to zeros and empty lists", () => {
  const r = parseSalesReport({ from: "2026-12-10", to: "2026-12-10", summary: {} });
  assert.equal(r.summary.net_paise, 0);
  assert.deepEqual([r.money, r.products, r.categories, r.sources], [[], [], [], []]);
  assert.ok(reportToCsv(r, labels).includes("Bills,0"));
});

test("quick picks: today, yesterday, this week (from Monday) and this month", () => {
  const today = "2026-11-12"; // a Thursday
  assert.deepEqual(reportRange({ range: "today" }, today), { from: today, to: today });
  assert.deepEqual(reportRange({}, today), { from: today, to: today });
  assert.deepEqual(reportRange({ range: "yesterday" }, today), { from: "2026-11-11", to: "2026-11-11" });
  assert.deepEqual(reportRange({ range: "week" }, today), { from: "2026-11-09", to: today });
  assert.deepEqual(reportRange({ range: "month" }, today), { from: "2026-11-01", to: today });
  assert.deepEqual(reportRange({ range: "week" }, "2026-11-09"), { from: "2026-11-09", to: "2026-11-09" });
  assert.deepEqual(reportRange({ range: "week" }, "2026-11-15"), { from: "2026-11-09", to: "2026-11-15" });
});

test("custom ranges are checked before they reach the database", () => {
  assert.deepEqual(reportRange({ from: "2026-11-01", to: "2026-11-05" }, "2026-11-12"), { from: "2026-11-01", to: "2026-11-05" });
  assert.equal(reportRange({ from: "2026-11-05", to: "2026-11-01" }, "2026-11-12").error, "Choose a start date on or before the end date.");
  assert.equal(reportRange({ from: "2025-01-01", to: "2026-11-01" }, "2026-11-12").error, "Choose a range of at most one year.");
  assert.equal(reportRange({ from: "nonsense", to: "2026-11-01" }, "2026-11-12").error, "Enter dates as YYYY-MM-DD.");
});
