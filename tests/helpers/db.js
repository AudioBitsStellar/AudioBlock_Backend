"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMockRepository = createMockRepository;
exports.setupTestDb = setupTestDb;
exports.teardownTestDb = teardownTestDb;
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
function createMockRepository(overrides = {}) {
    const repo = {};
    for (const name of REPOSITORY_METHOD_NAMES) {
        repo[name] = jest.fn();
    }
    return { ...repo, ...overrides };
}
/**
 * Wires an already-`jest.mock()`ed AppDataSource's getRepository to return
 * `repoOrMap` for every entity, or dispatch per-entity when given a
 * Map<EntityClass, MockRepository>. `jest.mock('../../config/db', ...)`
 * must still be declared in the consuming test file itself (jest.mock calls
 * are hoisted and cannot be issued from inside this helper) — call
 * setupTestDb from beforeEach, after that mock is in place.
 */
function setupTestDb(mockDataSource, repoOrMap) {
    if (repoOrMap instanceof Map) {
        mockDataSource.getRepository.mockImplementation((entity) => {
            const repo = repoOrMap.get(entity);
            if (!repo) {
                throw new Error(`setupTestDb: no mock repository registered for entity ${entity?.name}`);
            }
            return repo;
        });
    }
    else {
        mockDataSource.getRepository.mockReturnValue(repoOrMap);
    }
}
/** Resets the getRepository mock (call from afterEach/afterAll). */
function teardownTestDb(mockDataSource) {
    mockDataSource.getRepository.mockReset();
}
