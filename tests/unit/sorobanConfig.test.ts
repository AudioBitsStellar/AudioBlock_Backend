import fs from 'fs';
import path from 'path';

describe('Soroban network passphrase configuration', () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), 'src/config/soroban.ts'),
    'utf8',
  );

  it('derives passphrases from Stellar testnet and public networks', () => {
    expect(source).toContain('testnet: Networks.TESTNET');
    expect(source).toContain('mainnet: Networks.PUBLIC');
  });

  it('allows explicit network-specific overrides before the derived default', () => {
    expect(source).toContain('SOROBAN_${network.toUpperCase()}_NETWORK_PASSPHRASE');
  });
});
