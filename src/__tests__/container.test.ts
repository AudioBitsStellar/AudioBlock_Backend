import { Container } from '../container';

describe('Dependency Injection Container', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  describe('Service Registration', () => {
    it('should register a service successfully', () => {
      container.register('TestService', () => ({ name: 'test' }), 'singleton');
      expect(container.has('TestService')).toBe(true);
    });

    it('should throw error when registering duplicate service', () => {
      container.register('TestService', () => ({ name: 'test' }));
      
      expect(() => {
        container.register('TestService', () => ({ name: 'test2' }));
      }).toThrow('Service "TestService" is already registered');
    });
  });

  describe('Service Resolution', () => {
    it('should resolve a registered service', () => {
      container.register('TestService', () => ({ name: 'test' }), 'singleton');
      
      const service = container.resolve('TestService');
      
      expect(service).toEqual({ name: 'test' });
    });

    it('should throw error when resolving unregistered service', () => {
      expect(() => {
        container.resolve('NonExistentService');
      }).toThrow('Service "NonExistentService" not found in container');
    });

    it('should return same instance for singleton services', () => {
      let callCount = 0;
      container.register('TestService', () => {
        callCount++;
        return { name: 'test', id: callCount };
      }, 'singleton');
      
      const service1 = container.resolve('TestService');
      const service2 = container.resolve('TestService');
      
      expect(service1).toBe(service2);
      expect(callCount).toBe(1);
    });

    it('should return different instances for transient services', () => {
      let callCount = 0;
      container.register('TestService', () => {
        callCount++;
        return { name: 'test', id: callCount };
      }, 'transient');
      
      const service1 = container.resolve('TestService');
      const service2 = container.resolve('TestService');
      
      expect(service1).not.toBe(service2);
      expect(callCount).toBe(2);
    });
  });

  describe('Constructor Injection', () => {
    it('should resolve dependencies via constructor injection', () => {
      container.register('DatabaseService', () => ({ 
        query: () => 'db result' 
      }), 'singleton');
      
      container.register('UserService', (c) => {
        const db = c.resolve('DatabaseService');
        return {
          getUser: () => db.query(),
        };
      }, 'singleton');
      
      const userService = container.resolve<any>('UserService');
      
      expect(userService.getUser()).toBe('db result');
    });
  });

  describe('Circular Dependency Detection', () => {
    it('should detect direct circular dependencies', () => {
      container.register('ServiceA', (c) => {
        c.resolve('ServiceB');
        return { name: 'A' };
      });
      
      container.register('ServiceB', (c) => {
        c.resolve('ServiceA');
        return { name: 'B' };
      });
      
      expect(() => {
        container.resolve('ServiceA');
      }).toThrow(/Circular dependency detected/);
    });

    it('should detect indirect circular dependencies', () => {
      container.register('ServiceA', (c) => {
        c.resolve('ServiceB');
        return { name: 'A' };
      });
      
      container.register('ServiceB', (c) => {
        c.resolve('ServiceC');
        return { name: 'B' };
      });
      
      container.register('ServiceC', (c) => {
        c.resolve('ServiceA');
        return { name: 'C' };
      });
      
      expect(() => {
        container.resolve('ServiceA');
      }).toThrow(/Circular dependency detected/);
    });
  });

  describe('Container Management', () => {
    it('should clear specific service instance', () => {
      let callCount = 0;
      container.register('TestService', () => {
        callCount++;
        return { id: callCount };
      }, 'singleton');
      
      const service1 = container.resolve<any>('TestService');
      container.clear('TestService');
      const service2 = container.resolve<any>('TestService');
      
      expect(service1.id).toBe(1);
      expect(service2.id).toBe(2);
      expect(callCount).toBe(2);
    });

    it('should clear all service instances', () => {
      container.register('Service1', () => ({ name: 'service1' }), 'singleton');
      container.register('Service2', () => ({ name: 'service2' }), 'singleton');
      
      container.resolve('Service1');
      container.resolve('Service2');
      
      container.clearAll();
      
      // Services should be re-instantiated
      expect(container.has('Service1')).toBe(true);
      expect(container.has('Service2')).toBe(true);
    });

    it('should return list of registered services', () => {
      container.register('Service1', () => ({}));
      container.register('Service2', () => ({}));
      container.register('Service3', () => ({}));
      
      const services = container.getRegisteredServices();
      
      expect(services).toContain('Service1');
      expect(services).toContain('Service2');
      expect(services).toContain('Service3');
      expect(services.length).toBe(3);
    });
  });

  describe('Scoped Containers', () => {
    it('should create scoped container for testing', () => {
      container.register('Service1', () => ({ name: 'original' }), 'singleton');
      
      const scopedContainer = container.createScope();
      
      expect(scopedContainer.has('Service1')).toBe(true);
      expect(scopedContainer).not.toBe(container);
    });

    it('should not share singleton instances with parent', () => {
      let parentCount = 0;
      container.register('CounterService', () => {
        parentCount++;
        return { count: parentCount };
      }, 'singleton');
      
      const service1 = container.resolve<any>('CounterService');
      const scopedContainer = container.createScope();
      const service2 = scopedContainer.resolve<any>('CounterService');
      
      expect(service1.count).toBe(1);
      expect(service2.count).toBe(2);
    });
  });

  describe('Performance', () => {
    it('should resolve service within performance threshold', () => {
      container.register('FastService', () => ({ name: 'fast' }), 'singleton');
      
      const start = performance.now();
      container.resolve('FastService');
      const duration = performance.now() - start;
      
      expect(duration).toBeLessThan(5); // 5ms threshold
    });
  });
});
