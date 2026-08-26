import { pinataCircuitBreaker } from '../services/PinataService';

describe('PinataService Resilience & Circuit Breaker', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('exports pinataCircuitBreaker instance', () => {
    expect(pinataCircuitBreaker).toBeDefined();
    expect(pinataCircuitBreaker.currentState).toBe('CLOSED');
  });

  it('handles circuit breaker execution correctly', async () => {
    const mockFn = jest.fn().mockResolvedValue('success');
    const res = await pinataCircuitBreaker.execute(mockFn);
    expect(res).toBe('success');
  });
});
