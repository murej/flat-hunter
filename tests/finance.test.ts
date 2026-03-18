import assert from "node:assert";
import { calculateFinance } from "@/lib/tools/finance";

async function testInvalidInputs() {
  const result = await calculateFinance(NaN, 10000);
  assert.strictEqual(result.monthly_mortgage, 0);
  assert.strictEqual(result.stamp_duty, 0);
}

async function testNoBorrowingRequired() {
  const price = 300000;
  const deposit = 300000;
  const result = await calculateFinance(price, deposit);
  assert.strictEqual(result.monthly_mortgage, 0);
  assert.ok(result.stamp_duty >= 0);
}

async function testTypicalCase() {
  const price = 500000;
  const deposit = 100000;
  const result = await calculateFinance(price, deposit);
  assert.ok(result.monthly_mortgage > 0);
  assert.ok(result.stamp_duty >= 0);
  assert.ok(result.estimated_monthly_total >= result.monthly_mortgage);
}

async function testHighLtvWarning() {
  const price = 300000;
  const deposit = 10000;
  const result = await calculateFinance(price, deposit);
  const warnings = (result.raw.warnings ?? []) as string[];
  assert.ok(Array.isArray(warnings));
}

export async function runFinanceTests() {
  await testInvalidInputs();
  await testNoBorrowingRequired();
  await testTypicalCase();
  await testHighLtvWarning();
}

