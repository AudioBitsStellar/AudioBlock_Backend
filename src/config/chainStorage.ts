import type { DataSource } from 'typeorm';
import { getSorobanNetwork } from './soroban';

/** Refuse to serve or index a deployment against another network's read models. */
export async function validateChainStorage(
  db: Pick<DataSource, 'query'>,
  network = getSorobanNetwork(),
): Promise<void> {
  const rows: Array<{ network: string | null }> = await db.query(
    `SELECT network
       FROM (
         SELECT network FROM indexed_events
         UNION ALL SELECT network FROM indexer_cursors
         UNION ALL SELECT network FROM backfill_status
         UNION ALL SELECT network FROM onchain_event_counts
         UNION ALL SELECT "chainNetwork" FROM songs
           WHERE NULLIF("onChainSongId", '') IS NOT NULL
              OR NULLIF("onChainTokenId", '') IS NOT NULL
         UNION ALL SELECT "chainNetwork" FROM users
           WHERE NULLIF("stellarArtistId", '') IS NOT NULL
              OR NULLIF("stellarArtistTokenId", '') IS NOT NULL
         UNION ALL SELECT "chainNetwork" FROM royalty_payouts AS payout
           WHERE NULLIF(to_jsonb(payout)->>'onChainEventId', '') IS NOT NULL
              OR NULLIF(to_jsonb(payout)->>'saleEventId', '') IS NOT NULL
              OR NULLIF(to_jsonb(payout)->>'saleTxHash', '') IS NOT NULL
         UNION ALL SELECT "chainNetwork" FROM transactions_logs
           WHERE NULLIF("txHash", '') IS NOT NULL
       ) AS chain_records
       WHERE network IS NULL OR network NOT IN ($1, $2)
       LIMIT 1`,
    [network, `stellar-${network}`],
  );

  if (rows.length > 0) {
    throw new Error(
      `Soroban database network mismatch: expected ${network}, found ${rows[0].network ?? 'unverified legacy record'}. ` +
        'Use the database provisioned for the configured network.',
    );
  }
}
