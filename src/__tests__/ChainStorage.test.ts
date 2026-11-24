import { validateChainStorage } from '../config/chainStorage';

it('accepts the active network and its historical label', async () => {
  const db = { query: jest.fn().mockResolvedValue([]) };
  await expect(validateChainStorage(db, 'mainnet')).resolves.toBeUndefined();
  expect(db.query).toHaveBeenCalledWith(expect.any(String), ['mainnet', 'stellar-mainnet']);
});

it('fails startup when a record belongs to another network', async () => {
  const db = { query: jest.fn().mockResolvedValue([{ network: 'testnet' }]) };
  await expect(validateChainStorage(db, 'mainnet')).rejects.toThrow(
    'expected mainnet, found testnet',
  );
});
