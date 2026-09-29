# Account Types: Artist vs Listener

**Status:** Implemented (Issue #616)
**Related Issues:** #612 (Embedded Wallet), #614 (Stellar Wallet Linking), #615 (RBAC)

## Overview

AudioBlock supports two primary account types that determine what actions users can perform on the platform:

1. **Listener** - Basic user account for consuming content
2. **Artist** - Creator account with upload and monetization capabilities

## Account Type Distinction

### Listener Account

Listeners are the default account type for new signups. They can:

- Stream and discover music
- Create and manage playlists
- Follow artists
- Comment on tracks
- Save favorite songs
- View public profiles

**Permissions:**

- `read:public` - View public content
- `read:own_profile` - View own profile
- `update:own_profile` - Update own profile
- `create:playlist` - Create playlists
- `update:own_playlist` - Manage own playlists
- `delete:own_playlist` - Delete own playlists
- `create:comment` - Post comments
- `update:own_comment` - Edit own comments
- `delete:own_comment` - Delete own comments

### Artist Account

Artists have all listener capabilities plus:

- Upload songs and albums
- Manage catalog and metadata
- View streaming analytics
- Configure royalty splits
- Manage collaborators
- Access monetization features
- Connect on-chain wallet for payments

**Additional Permissions:**

- `create:song` - Upload new tracks
- `read:own_song` - View own songs
- `update:own_song` - Edit own tracks
- `delete:own_song` - Remove tracks
- `create:album` - Create albums
- `read:own_album` - View own albums
- `update:own_album` - Edit albums
- `delete:own_album` - Delete albums
- `read:analytics` - View streaming data
- `read:royalties` - Access royalty information

## Account Type Selection

### During Signup (Issue #616)

When creating an account via Privy, users can optionally specify their account type:

```json
POST /api/auth/privy/login
{
  "idToken": "privy_id_token_here",
  "accountType": "artist",
  "username": "cool_artist"
}
```

- orization: Bearer <access_token>
  {
  "artistName": "New Artist Name",
  "bio": "Artist bio here"
  }

````

### Upgrade Requirements

- Must be authenticated
- Current role must be "listener"
- No special verification required (opens access immediately)

### What Happens During Upgrade

1. User role changed from `listener` to `artist`
2. Artist profile fields populated (name, bio)
3. Upload capabilities enabled
4. Analytics dashboard becomes accessible
5. Royalty management features unlocked

## Downgrading from Artist to Listener

**Important:** Downgrading is restricted if the artist has uploaded content.

### Downgrade Rules

- **Allowed:** Artist accounts with zero uploaded content
- **Blocked:** Artist accounts with any songs, albums, or active royalty splits

To downgrade an artist account with content:
1. Delete all uploaded songs
2. Remove all albums
3. Then request account type change

## Account Type API

### Check Current Account Type

```bash
GET /api/account-type
Authorization: Bearer <access_token>
````

**Response:**

```json
{
  "success": true,
  "accountType": "artist",
  "isArtist": true,
  "isListener": false,
  "canUploadContent": true,
  "user": {
    "id": "user_123",
    "role": "artist",
    "username": "cool_artist",
    "name": "Cool Artist",
    "email": "artist@example.com"
  }
}
```

### Set Account Type

```bash
POST /api/account-type
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "accountType": "artist",
  "artistName": "Stage Name",
  "bio": "Optional bio"
}
```

**Validation:**

- `accountType`: Required, must be "artist" or "listener"
- `artistName`: Optional string, used for display name
- `bio`: Optional string, artist biography

### Upgrade to Artist (Convenience Endpoint)

```bash
POST /api/upgrade-to-artist
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "artistName": "New Artist",
  "bio": "My artist bio"
}
```

## Integration with Privy Auth

### Embedded Wallet Creation (Issue #612)

When a user signs up via Privy:

1. Privy automatically creates an embedded wallet
2. Webhook notifies backend of `user.created` event
3. Local account created with account type (default: listener)
4. Embedded wallet address linked to user profile

### Stellar Wallet Linking (Issue #614)

When a user connects a Stellar wallet:

1. User initiates wallet connection in Privy UI
2. Privy webhook sends `user.linked_account` event
3. Backend detects Stellar wallet (address starts with 'G')
4. `stellarPublicKey` field updated on user record
5. Artist can now receive on-chain royalty payments

## Role-Based Access Control (Issue #615)

Account types integrate with the RBAC system:

### Middleware Usage

Protect artist-only routes:

```typescript
import { requireArtist } from '../middlewares/rbacMiddleware';

router.post('/upload', requireAuth, requireArtist, uploadSong);
```

Require specific permissions:

```typescript
import { requirePermissions } from '../middlewares/rbacMiddleware';

router.post('/song/:id', requireAuth, requirePermissions(['update:own_song']), updateSong);
```

Check resource ownership:

```typescript
import { canAccessResource } from '../middlewares/rbacMiddleware';

if (!canAccessResource(req.user, song.userId)) {
  throw AppError.authorization('Cannot edit this song');
}
```

## Database Schema

Account type is stored in the `users` table:

```sql
ALTER TABLE users ADD COLUMN role VARCHAR DEFAULT 'listener';
CREATE INDEX idx_users_role ON users(role);
```

**Valid role values:**

- `listener` (default)
- `artist`
- `moderator` (staff)
- `admin` (staff)
- `super_admin` (staff)

## Best Practices

### For Frontend Integration

1. **Show appropriate UI based on account type:**
   - Listeners see browse/play interfaces
   - Artists see upload buttons and analytics

2. **Prompt upgrade when needed:**
   - If listener tries to upload, show upgrade flow
   - Explain benefits of artist account

3. **Validate permissions client-side:**
   - Disable buttons user can't use
   - Backend still enforces permissions

4. **Cache account type:**
   - Include in JWT payload for offline checks
   - Refresh on account type changes

### For Backend Development

1. **Always verify permissions:**
   - Never trust client-supplied role
   - Re-check role on every protected route

2. **Use RBAC middleware consistently:**
   - Don't bypass role checks
   - Use provided helper functions

3. **Handle upgrade edge cases:**
   - Check for existing content before downgrade
   - Validate artist profile completeness

4. **Log role changes:**
   - Audit all account type modifications
   - Track who initiated changes

## Testing

### Unit Tests

See `src/__tests__/AccountTypeService.test.ts` for comprehensive test coverage including:

- Setting account type
- Upgrading to artist
- Downgrade validation
- Permission checks

### Integration Tests

Test the full account type flow:

1. Sign up as listener
2. Create playlist (listener capability)
3. Attempt upload (should fail)
4. Upgrade to artist
5. Upload song (should succeed)

## Security Considerations

1. **Role Enforcement**
   - All role checks happen server-side
   - JWT contains role but is not trusted alone
   - Database is source of truth for roles

2. **Privilege Escalation Prevention**
   - Users cannot directly set moderator/admin roles
   - Only super_admin can assign privileged roles
   - Audit logs track all role changes

3. **Content Protection**
   - Artists cannot delete others' content (unless admin+)
   - Moderators can flag but not delete without review
   - Admins can perform any action with audit trail

## Future Enhancements

- [ ] Artist verification badges
- [ ] Listener supporter tiers
- [ ] Organization/label accounts
- [ ] Custom role creation
- [ ] Role-based rate limits

## Related Documentation

- [RBAC Implementation](./RBAC.md)
- [Privy Authentication](./PRIVY_AUTH.md)
- [Privy Webhooks](./PRIVY_WEBHOOKS.md)
- [Stellar Integration](./ON_CHAIN_INTEGRATION.md)
