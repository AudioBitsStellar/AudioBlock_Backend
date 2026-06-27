import AppDataSource from "../config/db";
import { RoyaltyPayoutService } from "../services/RoyaltyPayoutService";

export async function runRoyaltyReconciliationJob(): Promise<void> {
  const service = new RoyaltyPayoutService();
  const result = await service.reconcilePendingPayouts();

  if (result.discrepancies.length > 0) {
    console.error(
      `Royalty reconciliation found ${result.discrepancies.length} payout discrepancy record(s)`,
    );
  }
}

if (require.main === module) {
  AppDataSource.initialize()
    .then(async () => {
      await runRoyaltyReconciliationJob();
    })
    .finally(async () => {
      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
      }
    })
    .catch((error) => {
      console.error("Royalty reconciliation failed:", error);
      process.exit(1);
    });
}
