/**
 * Config-driven registry of Soroban contracts to index (Issue #234).
 *
 * Each contract type is associated with the contract id configured for the
 * active network (see `src/config/soroban.ts`) and its own event decoder.
 * The live worker and the backfill CLI both iterate this registry so the same
 * 5 contracts are indexed with a consistent mapping.
 */
import { SorobanContracts } from '../../config/soroban';
import {
  ALL_CONTRACT_TYPES,
  EVENT_DECODERS,
  ContractType,
  SorobanEventDecoder,
} from './eventDecoders';

export interface IndexerContract {
  contractType: ContractType;
  contractId: string;
  decoder: SorobanEventDecoder;
}

/**
 * Build the full list of contracts to index for the active network.
 *
 * @param overrides - Optional per-type id overrides (used by the backfill CLI
 *                    when targeting a specific contract).
 */
export function buildIndexerContracts(
  overrides: Partial<Record<ContractType, string>> = {},
): IndexerContract[] {
  return ALL_CONTRACT_TYPES.map((contractType) => {
    const contractId =
      overrides[contractType] ?? (SorobanContracts[contractType] as unknown as string);
    return {
      contractType,
      contractId,
      decoder: EVENT_DECODERS[contractType],
    };
  });
}
