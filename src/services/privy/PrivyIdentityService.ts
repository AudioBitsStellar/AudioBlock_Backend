/**
 * Calls into the privileged Privy management API (app-secret authenticated).
 *
 * Separate from token verification on purpose: verifying a token needs no
 * secret, only the public JWKS, and must keep working during an incident. This
 * module needs `PRIVY_APP_SECRET` and is only used for account-lifecycle
 * operations — currently the GDPR deletion of a linked Privy identity
 * (Issue #633).
 *
 * Implemented against Privy's documented REST surface rather than the
 * `@privy-io/node` SDK. Every published version of that SDK declares a peer
 * dependency on `viem@^2.44`, which conflicts with the `viem@2.38.2` this repo
 * has pinned transitively through `@dynamic-labs-wallet/node-evm`; adding it
 * makes `npm install` fail outright. The one endpoint we need is a single
 * authenticated `DELETE`, so the dependency is not worth that. See #594, which
 * remains open and should re-evaluate the SDK once the viem pin can move.
 */

import axios from 'axios';
import logger from '../../config/logger';
import { getPrivyConfig } from '../../config/privyAuth';

/**
 * Permanently delete a Privy identity.
 *
 * Privy soft-deletes any embedded wallet by disassociating and archiving it
 * rather than destroying the key material, so wallet assets are not at risk from
 * this call. Per Privy's own guidance the operation is irreversible: if the
 * person logs in again they get a new DID and must relink their accounts.
 *
 * @param privyUserId - The Privy DID (`did:privy:...`).
 * @returns `true` if deleted, `false` if Privy reported the identity was
 *   already gone — an already-absent identity is the desired end state, so
 *   callers should treat it as success.
 * @throws {Error} If `PRIVY_APP_SECRET` is not configured, or Privy is
 *   unreachable / returned an unexpected status. Callers must be prepared for
 *   this: the local erasure still succeeds, and the failure is recorded for
 *   follow-up rather than blocking the data-subject request.
 */
export async function deleteLinkedPrivyIdentity(privyUserId: string): Promise<boolean> {
  if (typeof privyUserId !== 'string' || !privyUserId.startsWith('did:privy:')) {
    // Not a Privy DID, so there is nothing upstream to delete. Fail loudly
    // rather than issuing a request that can only 404.
    throw new Error(`"${String(privyUserId)}" is not a valid Privy DID`);
  }

  const config = getPrivyConfig();
  if (!config.appSecret) {
    throw new Error('PRIVY_APP_SECRET is required to delete a linked Privy identity');
  }

  const url = `${config.apiUrl}/v1/users/${encodeURIComponent(privyUserId)}`;

  try {
    await axios.delete(url, {
      timeout: config.requestTimeoutMs,
      headers: {
        // Basic auth, app id as username and app secret as password.
        Authorization: `Basic ${Buffer.from(`${config.appId}:${config.appSecret}`).toString('base64')}`,
        'privy-app-id': config.appId,
      },
    });
    logger.info({ privyUserId }, 'Deleted linked Privy identity');
    return true;
  } catch (error) {
    const status = (error as { response?: { status?: number } })?.response?.status;

    if (status === 404) {
      // Already deleted upstream. That is the state we wanted, so this is a
      // success rather than a failure to be retried forever.
      logger.info({ privyUserId }, 'Linked Privy identity was already deleted');
      return false;
    }

    throw error;
  }
}
