import assert from "node:assert";
import { parseEmailHtml, parseVerificationEmail } from "@/lib/tools/ingest";

async function testParseEmailHtmlEmpty() {
  const result = await parseEmailHtml("<html><body>No listings here</body></html>");
  assert.ok(Array.isArray(result));
}

async function testParseVerificationEmailNonVerification() {
  const result = await parseVerificationEmail(
    "<html><body>Weekly newsletter</body></html>",
    "Your weekly update",
  );
  assert.strictEqual(result.isVerification, false);
}

export async function runIngestTests() {
  await testParseEmailHtmlEmpty();
  await testParseVerificationEmailNonVerification();
}

