export type MockRepository = Record<string, jest.Mock>;
export type EntityClass = new (...args: unknown[]) => unknown;

const REPOSITORY_METHOD_NAMES = [
  'find',
  'findOne',
  'findOneBy',
  'create',
  'save',
  'update',
  'delete',
  'remove',
];

/**
 * Builds a mock TypeORM repository with the common CRUD methods stubbed,
 * merged with any custom overrides (e.g. extra query-builder methods).
 */
export function createMockRepository(overrides: Partial<MockRepository> = {}): MockRepository {
  const repo: MockRepository = {};
  for (const name of REPOSITORY_METHOD_NAMES) {
    repo[name] = jest.fn();
  }
  return { ...repo, ...overrides } as MockRepository;
}

/**
 * Wires an already-`jest.mock()`ed AppDataSource's getRepository to return
 * `repoOrMap` for every entity, or dispatch per-entity when given a
 * Map<EntityClass, MockRepository>. `jest.mock('../../config/db', ...)`
 * must still be declared in the consuming test file itself (jest.mock calls
 * are hoisted and cannot be issued from inside this helper) — call
 * setupTestDb from beforeEach, after that mock is in place.
 */
export function setupTestDb(
  mockDataSource: { getRepository: jest.Mock },
  repoOrMap: MockRepository | Map<EntityClass, MockRepository>,
): void {
  if (repoOrMap instanceof Map) {
    mockDataSource.getRepository.mockImplementation((entity: EntityClass) => {
      const repo = repoOrMap.get(entity);
      if (!repo) {
        throw new Error(`setupTestDb: no mock repository registered for entity ${entity?.name}`);
      }
      return repo;
    });
  } else {
    mockDataSource.getRepository.mockReturnValue(repoOrMap);
  }
}

/** Resets the getRepository mock (call from afterEach/afterAll). */
export function teardownTestDb(mockDataSource: { getRepository: jest.Mock }): void {
  mockDataSource.getRepository.mockReset();
}
