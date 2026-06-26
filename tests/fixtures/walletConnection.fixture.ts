/**
 * Shared test fixtures for wallet connection flow.
 * Both backend and frontend teams can reference these fixtures
 * to ensure contract alignment.
 */

export const validWalletConnections = {
  /**
   * Standard Stellar mainnet public key format (G-address, 56 chars)
   */
  standard: {
    stellarPublicKey: "GBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  },

  /**
   * Another valid example for testing multiple connections
   */
  alternative: {
    stellarPublicKey: "GDYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  },
};

export const invalidWalletConnections = {
  /**
   * Missing stellarPublicKey field entirely
   */
  missingField: {},

  /**
   * Empty string for public key
   */
  emptyString: {
    stellarPublicKey: "",
  },

  /**
   * Wrong format - doesn't start with G
   */
  wrongPrefix: {
    stellarPublicKey: "ABXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  },

  /**
   * Too short
   */
  tooShort: {
    stellarPublicKey: "GBXXX",
  },

  /**
   * Too long
   */
  tooLong: {
    stellarPublicKey:
      "GBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  },

  /**
   * M-address (secret key) - SECURITY RISK if accepted!
   */
  secretKey: {
    stellarPublicKey: "MXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  },

  /**
   * Contains invalid characters
   */
  invalidCharacters: {
    stellarPublicKey: "GB!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!",
  },
};

/**
 * Expected API responses
 */
export const expectedResponses = {
  success: {
    success: true,
    data: {
      stellarPublicKey: "GBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    },
  },

  invalidFormat: {
    success: false,
    fields: {
      stellarPublicKey:
        "stellarPublicKey must be a valid Stellar G... address.",
    },
    message: ["stellarPublicKey must be a valid Stellar G... address."],
  },

  missingField: {
    success: false,
    fields: {
      stellarPublicKey: "stellarPublicKey is required.",
    },
    message: ["stellarPublicKey is required."],
  },
};

/**
 * Frontend integration example (for reference)
 */
export const frontendIntegrationExample = `
import { isConnected, getPublicKey } from '@stellar/freighter-api';

async function connectWallet() {
  // 1. Check Freighter is installed
  if (!await isConnected()) {
    alert('Please install Freighter wallet extension');
    return;
  }
  
  // 2. Get public key from Freighter
  const publicKey = await getPublicKey();
  
  // 3. Send to backend
  const res = await fetch('/api/artist/onchain/connect-wallet', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': \`Bearer \${authToken}\`
    },
    body: JSON.stringify({ stellarPublicKey: publicKey })
  });
  
  // 4. Handle response
  const data = await res.json();
  if (data.success) {
    console.log('Wallet connected:', data.data.stellarPublicKey);
  } else {
    console.error('Connection failed:', data.message);
  }
}
`;
