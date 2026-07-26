/**
 * API contract tests (Issue #118).
 *
 * Validates that real controller responses match a JSON schema stored in
 * tests/schemas/, so response-shape drift fails CI instead of silently
 * breaking API consumers. No new schema-validator dependency: the shapes
 * checked here are shallow enough that a small structural checker (type +
 * required + nested properties) covers them without pulling in ajv.
 *
 * New endpoints should add a schema file under tests/schemas/ and a case
 * below rather than skipping contract coverage.
 */
import * as fs from 'fs';
import * as path from 'path';
import { HealthController } from '../../controllers/HealthController';
import { WalletController } from '../../controllers/WalletController';

// See src/controllers/__tests__/WalletController.test.ts for why this is a
// factory mock (with directly-referenced "mock"-prefixed fns) rather than a
// bare auto-mock or `.mock.instances`.
const mockCreateWallet = jest.fn();
const mockSignMessage = jest.fn();
jest.mock('../../services/Dynamic/WalletService', () => ({
  WalletService: jest.fn().mockImplementation(() => ({
    createWallet: mockCreateWallet,
    signMessage: mockSignMessage,
  })),
}));

const SCHEMA_DIR = path.join(__dirname, '../../../tests/schemas');

function loadSchema(name: string) {
  return JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, name), 'utf-8'));
}

type JsonSchema = {
  type?: string;
  required?: string[];
  properties?: Record<string, JsonSchema>;
};

/** Minimal structural validator: type + required + nested properties. */
function assertMatchesSchema(value: unknown, schema: JsonSchema): void {
  if (schema.type === 'object') {
    expect(typeof value).toBe('object');
    expect(value).not.toBeNull();
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      expect(obj).toHaveProperty(key);
    }
    for (const [key, propSchema] of Object.entries(schema.properties ?? {})) {
      if (key in obj) assertMatchesSchema(obj[key], propSchema);
    }
  } else if (schema.type === 'array') {
    expect(Array.isArray(value)).toBe(true);
  } else if (schema.type) {
    expect(typeof value).toBe(schema.type);
  }
}

function mockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('API contract: GET /health/live', () => {
  it('matches health-live.schema.json', () => {
    const res = mockRes();

    HealthController.live({} as any, res);

    expect(res.status).toHaveBeenCalledWith(200);
    assertMatchesSchema(res.json.mock.calls[0][0], loadSchema('health-live.schema.json'));
  });
});

describe('API contract: POST /wallet/evm/create', () => {
  let controller: WalletController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new WalletController();
  });

  it('matches wallet-create.schema.json on success', async () => {
    mockCreateWallet.mockResolvedValue({ accountAddress: '0xabc' });
    const res = mockRes();

    await controller.createEvmWallet({} as any, res);

    expect(res.status).toHaveBeenCalledWith(201);
    assertMatchesSchema(res.json.mock.calls[0][0], loadSchema('wallet-create.schema.json'));
  });

  it('matches wallet-create-error.schema.json on failure', async () => {
    mockCreateWallet.mockRejectedValue(new Error('Dynamic: Wallet creation failed'));
    const res = mockRes();

    await controller.createEvmWallet({} as any, res);

    assertMatchesSchema(res.json.mock.calls[0][0], loadSchema('wallet-create-error.schema.json'));
  });
});
