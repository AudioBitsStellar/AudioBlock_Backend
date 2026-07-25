/**
 * Service Registry for dependency injection and circular dependency resolution.
 *
 * This registry pattern allows services to access each other without direct imports,
 * preventing circular dependencies while maintaining type safety.
 *
 * Usage:
 * 1. Services register themselves on initialization
 * 2. Services retrieve dependencies via getService()
 * 3. Registry ensures lazy loading to break circular import cycles
 */

type ServiceConstructor<T = any> = new (...args: any[]) => T;
type ServiceFactory<T = any> = () => T;

interface ServiceRegistration<T = any> {
  factory: ServiceFactory<T>;
  instance?: T;
  singleton: boolean;
}

export class ServiceRegistry {
  private static services = new Map<string, ServiceRegistration>();

  /**
   * Register a service constructor or factory
   */
  static register<T>(
    name: string,
    factory: ServiceFactory<T> | ServiceConstructor<T>,
    options: { singleton?: boolean } = {},
  ): void {
    const { singleton = true } = options;

    const serviceFactory =
      typeof factory === "function" && factory.prototype
        ? () => new (factory as ServiceConstructor<T>)()
        : (factory as ServiceFactory<T>);

    this.services.set(name, {
      factory: serviceFactory,
      singleton,
    });
  }

  /**
   * Get a service instance by name
   */
  static getService<T>(name: string): T {
    const registration = this.services.get(name);

    if (!registration) {
      throw new Error(`Service "${name}" not registered in ServiceRegistry`);
    }

    // Return existing singleton instance
    if (registration.singleton && registration.instance) {
      return registration.instance as T;
    }

    // Create new instance
    const instance = registration.factory();

    // Cache singleton instance
    if (registration.singleton) {
      registration.instance = instance;
    }

    return instance as T;
  }

  /**
   * Check if a service is registered
   */
  static has(name: string): boolean {
    return this.services.has(name);
  }

  /**
   * Clear a specific service instance (useful for testing)
   */
  static clear(name: string): void {
    const registration = this.services.get(name);
    if (registration) {
      registration.instance = undefined;
    }
  }

  /**
   * Clear all service instances (useful for testing)
   */
  static clearAll(): void {
    this.services.forEach((registration) => {
      registration.instance = undefined;
    });
  }

  /**
   * Remove a service registration completely
   */
  static unregister(name: string): void {
    this.services.delete(name);
  }

  /**
   * Get all registered service names
   */
  static getRegisteredServices(): string[] {
    return Array.from(this.services.keys());
  }
}

/**
 * Type-safe service name constants to prevent typos
 */
export const SERVICE_NAMES = {
  USER_SERVICE: "UserService",
  AUTH_SERVICE: "AuthService",
  SONG_SERVICE: "SongService",
  ALBUM_SERVICE: "AlbumService",
  ARTIST_SERVICE: "ArtistService",
  ARTIST_PROFILE_SERVICE: "ArtistProfileService",
  SOROBAN_SERVICE: "SorobanService",
  TRANSACTION_LOG_SERVICE: "TransactionLogService",
  CACHE_SERVICE: "CacheService",
  EMAIL_SERVICE: "EmailService",
  PINATA_SERVICE: "PinataService",
  WALLET_SERVICE: "WalletService",
} as const;

/**
 * Helper to get a typed service instance
 */
export function getService<T>(name: string): T {
  return ServiceRegistry.getService<T>(name);
}
