# GDPR / Right-to-Erasure Compliance: AI Abstraction Review (#301)

## Scope

Review of the AI feature set (artist AI tools, recommendation engine, analytics)
for GDPR Article 17 (Right to Erasure) compliance.

## Current AI Data Processing

### 1. AI Artist Tools (Per-Artist Opt-in/Opt-out)

- **Data collected**: Song metadata, listening patterns, genre tags
- **Storage**: PostgreSQL (`ai_preferences` table per artist)
- **Erasure**: ✅ Artist can toggle opt-out; data deleted on account deletion
- **Recommendation**: Ensure AI model retraining excludes erased user data

### 2. Recommendation Engine

- **Data collected**: User listening history, saves, playlist additions
- **Storage**: Redis cache + PostgreSQL (`user_interactions` table)
- **Erasure**: ⚠️ Redis cache has TTL but PostgreSQL records need explicit deletion
- **Action needed**: Add cascade delete from `user_interactions` on user deletion

### 3. Analytics & Metrics

- **Data collected**: Play counts, geographic distribution, engagement scores
- **Storage**: PostgreSQL (`song_analytics` table), aggregated
- **Erasure**: ⚠️ Aggregated metrics cannot be un-aggregated; document this limitation
- **Action needed**: Add note that aggregated analytics survive erasure per Art. 17(3)(b)

## Erasure Checklist

| Data Store                    | Erasure Method                         | Status                  |
| ----------------------------- | -------------------------------------- | ----------------------- |
| `ai_preferences`              | CASCADE DELETE on user                 | ✅ Implemented          |
| `user_interactions`           | Explicit DELETE on user deletion       | ⚠️ Needs implementation |
| Redis recommendation cache    | TTL-based expiry                       | ✅ Working              |
| `song_analytics` (aggregated) | Cannot erase (Art. 17(3)(b))           | ✅ Documented           |
| Model training data           | Retraining exclusion list              | ⚠️ Needs implementation |
| AI-generated content          | Keep (Art. 17(3)(d) - public interest) | ✅ Documented           |

## Recommendations

1. **Add user_erased flag** to prevent AI from processing erased users' data
2. **Update recommendation query** to exclude `user_erased = true` users
3. **Document AI data retention** in privacy policy
4. **Implement audit log** for AI data access (who queried what, when)

## Acceptance Criteria

- [x] AI opt-out toggle works for artists
- [x] User deletion cascades to AI preferences
- [ ] User deletion cascades to user_interactions (action needed)
- [ ] Recommendation engine excludes erased users (action needed)
- [ ] Privacy policy documents AI data retention
