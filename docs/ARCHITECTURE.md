## AudioBlocks Backend Architecture

### Layer Separation

The codebase follows a clean architecture pattern with clear separation of concerns:

```
┌─────────────────────────────────────────────┐
│          HTTP Layer (Controllers)            │
│  - Request parsing                           │
│  - Response formatting                       │
│  - HTTP status codes                         │
│  - Error mapping                             │
└──────────────┬───────────────────────────────┘
               │
┌──────────────▼───────────────────────────────┐
│       Business Logic Layer (Services)        │
│  - Input validation                          │
│  - Business rules                            │
│  - Cross-service coordination                │
│  - Transaction management                    │
└──────────────┬───────────────────────────────┘
               │
┌──────────────▼───────────────────────────────┐
│        Data Layer (Repositories)             │
│  - Database queries                          │
│  - Entity management                         │
│  - Data persistence                          │
└──────────────────────────────────────────────┘
```

### Controller Pattern (Thin HTTP Layer)

**Rules:**

- Each controller method must be under 20 lines
- Controllers should ONLY handle HTTP concerns
- No business logic in controllers
- No direct database access in controllers
- All business logic delegated to services

**Good Controller Example:**

```typescript
getUserById = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const user = await this.userService.getUserById(id);
    res.status(HTTP_STATUS.OK).json(user);
  } catch (error) {
    handleError(res, error);
  }
};
```

**Bad Controller Example (Anti-pattern):**

```typescript
getUserById = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;

    // ❌ Business logic in controller
    if (!id) throw new Error("ID required");
    if (!isValidUUID(id)) throw new Error("Invalid ID");

    // ❌ Direct database access
    const user = await userRepo.findOneBy({ id });
    if (!user) throw new Error("User not found");

    // ❌ Data transformation logic
    const sanitizedUser = {
      ...user,
      passwordHash: undefined,
    };

    res.status(200).json(sanitizedUser);
  } catch (error) {
    handleError(res, error);
  }
};
```

### Service Pattern (Business Logic Layer)

**Rules:**

- Validate all inputs at service boundaries
- Throw AppError for validation/business logic failures
- No HTTP concerns (req, res, status codes)
- Services can call other services via ServiceRegistry
- All database operations go through services

**Service Validation Pattern:**

```typescript
async updateUser(id: string, data: Partial<User>): Promise<User> {
  // 1. Validate inputs
  validateRequired(id, "id");

  // 2. Check existence
  const user = await this.userRepo.findOneBy({ id });
  if (!user) {
    throw AppError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);
  }

  // 3. Validate business rules
  if (data.email && data.email !== user.email) {
    validateEmail(data.email);
    const existing = await this.userRepo.findOneBy({ email: data.email });
    if (existing) {
      throw AppError.conflict(ERROR_MESSAGES.EMAIL_ALREADY_EXISTS);
    }
  }

  // 4. Execute business logic
  Object.assign(user, data);
  return await this.userRepo.save(user);
}
```

### Circular Dependency Resolution

**Problem:**

```
ServiceA imports ServiceB
ServiceB imports ServiceA
→ Circular dependency error
```

**Solution: Service Registry Pattern**

```typescript
// ❌ BAD: Direct import causes circular dependency
import { SongService } from "../SongService";

export class AlbumService {
  private songService = new SongService(); // Circular!
}
```

```typescript
// ✅ GOOD: Use Service Registry
import { getService, SERVICE_NAMES } from "../ServiceRegistry";
import type { SongService } from "../SongService";

export class AlbumService {
  private getSongService(): SongService {
    return getService<SongService>(SERVICE_NAMES.SONG_SERVICE);
  }

  async someMethod() {
    const songService = this.getSongService();
    await songService.doSomething();
  }
}
```

**Service Registration:**

```typescript
// src/index.ts or bootstrap file
import { ServiceRegistry, SERVICE_NAMES } from "./services/ServiceRegistry";
import { UserService } from "./services/UserService";
import { SongService } from "./services/SongService";

// Register all services on startup
ServiceRegistry.register(SERVICE_NAMES.USER_SERVICE, UserService);
ServiceRegistry.register(SERVICE_NAMES.SONG_SERVICE, SongService);
```

### Error Handling

**AppError Types:**

```typescript
AppError.validation(); // 400 - Invalid input
AppError.authentication(); // 401 - Auth required
AppError.authorization(); // 403 - Permission denied
AppError.notFound(); // 404 - Resource not found
AppError.conflict(); // 409 - Duplicate/conflict
AppError.businessLogic(); // 400 - Business rule violation
AppError.externalService(); // 502 - External API failure
AppError.database(); // 500 - DB error
```

**Error Handling Flow:**

```
1. Service throws AppError
2. Controller catches error
3. handleError() maps AppError to HTTP response
4. Client receives structured error with status code
```

### Constants Management

All magic numbers and strings are centralized in `src/config/constants.ts`:

**Categories:**

- Security & Authentication
- Time Limits & Expiration
- Validation Limits
- HTTP Status Codes
- Error Messages
- Success Messages
- Blockchain & Web3
- File Upload Limits
- Database & Caching
- Rate Limiting

**Usage:**

```typescript
// ❌ BAD: Magic numbers
if (password.length < 8) throw new Error("Password too short");
setTimeout(() => { ... }, 300);

// ✅ GOOD: Named constants
import { PASSWORD_MIN_LENGTH, NONCE_EXPIRATION_SECONDS } from "../config/constants";

if (password.length < PASSWORD_MIN_LENGTH) {
  throw AppError.validation(ERROR_MESSAGES.PASSWORD_TOO_SHORT);
}
redis.set(key, value, "EX", NONCE_EXPIRATION_SECONDS);
```

### Validation Layers

**Three layers of validation:**

1. **HTTP Layer (DTOs with class-validator)**
   - Schema validation
   - Type checking
   - Format validation
2. **Service Layer (ServiceValidator functions)**
   - Business rule validation
   - Cross-field validation
   - Existence checks
3. **Database Layer (Entity constraints)**
   - Unique constraints
   - Foreign key constraints
   - NOT NULL constraints

**Why multiple layers?**

- Defense in depth
- Services can be called internally (bypassing HTTP)
- Better error messages at each layer
- Catch bugs early

### Testing Strategy

**Controller Tests:**

- Mock the service layer
- Test HTTP concerns only
- Verify status codes and response format

**Service Tests:**

- Test business logic
- Mock database repositories
- Test validation logic
- Test error scenarios

**Integration Tests:**

- Test full request flow
- Use real database (test DB)
- Verify end-to-end behavior

### Project Structure

```
src/
├── config/           # Configuration files
│   ├── constants.ts  # Centralized constants
│   ├── db.ts         # Database connection
│   └── redis.ts      # Redis connection
├── controllers/      # Thin HTTP layer
├── services/         # Business logic layer
│   └── ServiceRegistry.ts  # DI container
├── entities/         # TypeORM entities
├── dtos/             # Data transfer objects
├── validators/       # Reusable validation functions
│   └── ServiceValidator.ts
├── errors/           # Custom error classes
│   └── AppError.ts
├── middlewares/      # Express middlewares
├── routes/           # Route definitions
└── utils/            # Helper functions
```

### Best Practices

1. **Thin Controllers**: Delegate everything to services
2. **Fat Services**: All business logic lives here
3. **Validate Early**: Service boundary validation
4. **Use Constants**: No magic numbers/strings
5. **Structured Errors**: Always use AppError
6. **Service Registry**: Break circular dependencies
7. **Type Safety**: Leverage TypeScript fully
8. **Test Independently**: Each layer testable in isolation

### Migration Checklist

When refactoring existing code:

- [ ] Extract business logic from controllers to services
- [ ] Add service-layer input validation
- [ ] Replace magic numbers with named constants
- [ ] Replace `throw new Error()` with `AppError.*`
- [ ] Break circular dependencies with ServiceRegistry
- [ ] Reduce controller methods to <20 lines
- [ ] Add JSDoc comments to public methods
- [ ] Update tests to match new structure
