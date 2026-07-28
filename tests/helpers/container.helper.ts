/**
 * Test helpers for dependency injection container
 *
 * Provides utilities for creating test containers with mock services.
 */

import { Container } from '../../src/container';

/**
 * Create a test container with optional mock services
 */
export function createTestContainer(mocks: Record<string, any> = {}): Container {
  const testContainer = new Container();

  // Register mock services
  Object.entries(mocks).forEach(([name, mockInstance]) => {
    testContainer.register(name, () => mockInstance, 'singleton');
  });

  return testContainer;
}

/**
 * Create a mock service factory
 */
export function createMockService<T>(overrides: Partial<T> = {}): T {
  return overrides as T;
}

/**
 * Example usage in tests:
 *
 * ```typescript
 * const testContainer = createTestContainer({
 *   UserService: createMockService({
 *     findById: jest.fn().mockResolvedValue({ id: '1', email: 'test@example.com' }),
 *     create: jest.fn().mockResolvedValue({ id: '2', email: 'new@example.com' }),
 *   }),
 * });
 *
 * const userService = testContainer.resolve('UserService');
 * const user = await userService.findById('1');
 * ```
 */
