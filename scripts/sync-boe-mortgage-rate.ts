import { syncMortgageRateFromEnv } from "../lib/sync-boe-mortgage-rate";

async function main() {
  try {
    const { rate } = await syncMortgageRateFromEnv();
    console.log(`Mortgage rate synced: ${rate}%`);
  } catch (e) {
    console.error(
      "Error syncing rate:",
      e instanceof Error ? e.message : e,
    );
    process.exit(1);
  }
}

main();
