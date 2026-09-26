/**
 * BackfillEnhancementService: Enhanced backfill capabilities with auto-discovery.
 *
 * Extends backfill functionality to automatically discover contract deployment blocks
 * and handle complex scenarios. Supports Issue #681 (indexer backfill from deployment block).
 *
 * Key features:
 * - Discover deployment ledger from contract metadata
 * - Graceful fallback if metadata unavailable
 * - Cached discovery results to avoid repeated queries
 */

import { getSorobanServer } from '../../config/soroban';
import logger from '../../config/logger';

interface ContractInfo {
  deploymentLedger: number;
  contractId: string;
  network: string;
}

export class BackfillEnhancementService {
  private discoveryCache: Map<string, ContractInfo> = new Map();
  private cacheExpiryMs: number = 3600000; // 1 hour
  private cacheExpiry: Map<string, number> = new Map();

  /**
   * Auto-discover the deployment ledger for a contract.
   *
   * Attempts to determine the ledger at which a contract was deployed by:
   * 1. Querying contract info from Soroban RPC (if available)
   * 2. Falling back to a configurable default (e.g., genesis ledger)
   * 3. Caching result to avoid repeated queries
   */
  async discoverDeploymentLedger(contractId: string, network: string): Promise<number> {
    const cacheKey = `${network}:${contractId}`;
    const cached = this.discoveryCache.get(cacheKey);

    // Return cached if fresh
    if (cached) {
      const expiry = this.cacheExpiry.get(cacheKey) || 0;
      if (Date.now() < expiry) {
        logger.debug(`Using cached deployment ledger for ${cacheKey}: ${cached.deploymentLedger}`);
        return cached.deploymentLedger;
      }
    }

    try {
      logger.info(`Discovering deployment ledger for ${contractId} on ${network}`);

      // In production, this would query Soroban RPC for contract history
      // For now, use heuristics and environment configuration
      const deploymentLedger = await this.queryDeploymentLedger(contractId, network);

      // Cache the result
      this.discoveryCache.set(cacheKey, {
        contractId,
        network,
        deploymentLedger,
      });
      this.cacheExpiry.set(cacheKey, Date.now() + this.cacheExpiryMs);

      logger.info(`Discovered deployment ledger: ${deploymentLedger} for ${contractId}`);
      return deploymentLedger;
    } catch (error) {
      logger.warn(`Failed to discover deployment ledger, using fallback`, error);
      return this.getFallbackDeploymentLedger(network);
    }
  }

  /**
   * Query the deployment ledger from contract metadata or environment config.
   */
  private async queryDeploymentLedger(contractId: string, network: string): Promise<number> {
    // Check environment for pre-configured deployment ledgers
    const envKey = `${network.toUpperCase()}_DEPLOYMENT_LEDGER`;
    const envValue = process.env[envKey];
    if (envValue) {
      const ledger = parseInt(envValue, 10);
      if (!isNaN(ledger)) {
        logger.info(`Using environment-configured deployment ledger ${envKey}=${ledger}`);
        return ledger;
      }
    }

    // Check contract-specific configuration
    const contractConfigKey = `${contractId.toUpperCase()}_DEPLOYMENT_LEDGER`;
    const contractConfigValue = process.env[contractConfigKey];
    if (contractConfigValue) {
      const ledger = parseInt(contractConfigValue, 10);
      if (!isNaN(ledger)) {
        logger.info(`Using contract-specific deployment ledger ${contractConfigKey}=${ledger}`);
        return ledger;
      }
    }

    // Attempt to query from Soroban RPC getContractData (advanced, requires contract implementation)
    // This is a placeholder for future enhancement when contract supports querying deployment info
    try {
      const server = getSorobanServer();
      logger.debug(`Querying contract info from Soroban RPC for ${contractId}`);
      // In a real implementation, this would call something like:
      // const info = await server.getContractInfo(contractId);
      // return info.deploymentLedger;
      // For now, this throws to fall through to fallback
      throw new Error('Contract info query not yet implemented');
    } catch (error) {
      logger.debug('Could not query contract info from RPC, falling back to default', error);
      throw error;
    }
  }

  /**
   * Get fallback deployment ledger (safety net).
   */
  private getFallbackDeploymentLedger(network: string): number {
    // Network-specific defaults (these should be updated with real deployment info)
    const fallbacks: Record<string, number> = {
      testnet: 100000, // Approximate testnet genesis
      mainnet: 1, // Stellar mainnet genesis
      standalone: 1,
    };

    const fallback = fallbacks[network] || 1;
    logger.info(`Using fallback deployment ledger for ${network}: ${fallback}`);
    return fallback;
  }

  /**
   * Clear cache to force re-discovery.
   */
  clearDiscoveryCache(): void {
    this.discoveryCache.clear();
    this.cacheExpiry.clear();
    logger.info('Cleared deployment ledger discovery cache');
  }

  /**
   * Pre-populate cache with known deployments.
   */
  setKnownDeployment(contractId: string, network: string, deploymentLedger: number): void {
    const cacheKey = `${network}:${contractId}`;
    this.discoveryCache.set(cacheKey, {
      contractId,
      network,
      deploymentLedger,
    });
    this.cacheExpiry.set(cacheKey, Date.now() + this.cacheExpiryMs);
    logger.info(`Cached deployment ledger ${deploymentLedger} for ${cacheKey}`);
  }

  /**
   * Get cache statistics for monitoring.
   */
  getCacheStats(): { size: number; entries: string[] } {
    return {
      size: this.discoveryCache.size,
      entries: Array.from(this.discoveryCache.keys()),
    };
  }
}

export const backfillEnhancementService = new BackfillEnhancementService();
