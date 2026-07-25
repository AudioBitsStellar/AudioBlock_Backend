# Refactoring Priority

The following functions and files have been identified by our automated complexity analysis as candidates for refactoring. They currently exceed the established thresholds for cyclomatic complexity and/or function length (as configured in `.eslintrc.js`).

## Top Complex Functions

1. **`mapToOnChainError`** in `src/types/OnChainErrorCodes.ts`
   - **Metrics:** Cyclomatic complexity of 24 (limit: 15), 125 lines (limit: 50).
   - **Reason:** Large switch/if-else chains mapping contract errors. Consider extracting to a mapping object or smaller helpers.

2. **`startSongWorker`** in `src/workers/SongProcessorWorker.ts`
   - **Metrics:** Cyclomatic complexity of 18 (limit: 15), 196 lines (limit: 50).
   - **Reason:** Heavy business logic and deeply nested async arrow functions. Extract the inner job processing logic into its own method or class.

3. **`finalizeUpload`** in `src/services/SongService.ts`
   - **Metrics:** 126 lines (limit: 50), 9 parameters (limit: 5).
   - **Reason:** Handles too many responsibilities (chunk merging, DB updates, queueing). Extract S3/file logic or introduce an options object for parameters.

4. **Twitter OAuth Callback** (`router.get('/callback')`) in `src/routes/twitterRoutes.ts`
   - **Metrics:** Cyclomatic complexity of 16 (limit: 15), 100 lines (limit: 50).
   - **Reason:** Mixes API requests, database queries, and session management. Extract Twitter API calls and user linking logic to a dedicated service.

5. **`startWorker`** in `src/workers/transcode.worker.ts`
   - **Metrics:** 88 lines (limit: 50).
   - **Reason:** Consumes messages and handles heavy transcoding logic inline. Should delegate to smaller specialized functions.

6. **`createUser`** in `src/services/UserService.ts`
   - **Metrics:** 63 lines (limit: 50).
   - **Reason:** Validations and DB logic mixed. Refactoring to smaller steps will help maintainability.

---
*Note: This list is intended to guide future tech debt sprints. New code should adhere to the complexity limits enforced by CI.*
