import { Account, Keypair, Networks, Operation, TransactionBuilder, rpc } from '@stellar/stellar-sdk';
import { getSorobanServer } from '../config/soroban';
import { SorobanService } from '../services/Soroban/SorobanService';

jest.mock('../config/soroban', () => ({
  getNetworkPassphrase: () => Networks.TESTNET,
  getSorobanServer: jest.fn(),
}));
jest.mock('../config/logger', () => ({ warn: jest.fn() }));
jest.mock('../services/MetricsService', () => ({
  sorobanRpcCallsTotal: { inc: jest.fn() },
  sorobanRpcLatencySeconds: { observe: jest.fn() },
}));

const missing = { status: rpc.Api.GetTransactionStatus.NOT_FOUND };
const success = { status: rpc.Api.GetTransactionStatus.SUCCESS };

function setup() {
  const signer = Keypair.random();
  const transaction = new TransactionBuilder(new Account(signer.publicKey(), '0'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.bumpSequence({ bumpTo: '2' }))
    .setTimeout(120)
    .build();
  transaction.sign(signer);
  const server = { getTransaction: jest.fn(), sendTransaction: jest.fn() };
  jest.mocked(getSorobanServer).mockReturnValue(server as unknown as rpc.Server);
  return {
    server,
    service: new SorobanService(),
    signed: transaction.toXDR(),
    hash: transaction.hash().toString('hex'),
  };
}

afterEach(() => jest.useRealTimers());

it('returns the ledger outcome without sending an already included envelope', async () => {
  const { server, service, signed, hash } = setup();
  server.getTransaction.mockResolvedValue(success);
  await expect(service.submitSignedTransaction(signed)).resolves.toMatchObject({ hash });
  expect(server.getTransaction).toHaveBeenCalledWith(hash);
  expect(server.sendTransaction).not.toHaveBeenCalled();
});

it.each(['timeout', 'try again later'])('retries %s using the identical signed envelope', async (failure) => {
  const { server, service, signed, hash } = setup();
  server.getTransaction.mockResolvedValueOnce(missing).mockResolvedValue(success);
  if (failure === 'timeout') server.sendTransaction.mockRejectedValueOnce(new Error('timeout'));
  else server.sendTransaction.mockResolvedValueOnce({ status: 'TRY_AGAIN_LATER' });
  server.sendTransaction.mockResolvedValueOnce({ status: 'DUPLICATE' });

  jest.useFakeTimers();
  const result = expect(service.submitSignedTransaction(signed)).resolves.toMatchObject({ hash });
  await jest.runAllTimersAsync();
  await result;
  expect(server.sendTransaction).toHaveBeenCalledTimes(2);
  for (const [sent] of server.sendTransaction.mock.calls) expect(sent.toXDR()).toBe(signed);
});

it('checks the original hash on a bad sequence instead of replacing the transaction', async () => {
  const { server, service, signed, hash } = setup();
  server.getTransaction.mockResolvedValueOnce(missing).mockResolvedValue(success);
  server.sendTransaction.mockResolvedValueOnce({
    status: 'ERROR',
    errorResult: { result: () => ({ switch: () => ({ name: 'txBadSeq' }) }) },
  });

  jest.useFakeTimers();
  const result = expect(service.submitSignedTransaction(signed)).resolves.toMatchObject({ hash });
  await jest.runAllTimersAsync();
  await result;
  expect(server.sendTransaction).toHaveBeenCalledTimes(1);
  expect(server.getTransaction).toHaveBeenLastCalledWith(hash);
});
