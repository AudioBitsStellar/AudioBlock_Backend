"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMockResponse = createMockResponse;
exports.createMockRequest = createMockRequest;
exports.createAuthenticatedRequest = createAuthenticatedRequest;
const auth_1 = require("./auth");
/**
 * Chainable mock Express Response, replacing the mockRes() duplicated
 * across WalletController.test.ts, UploadController.test.ts,
 * middleware.test.ts, and api.contract.test.ts.
 */
function createMockResponse() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.setHeader = jest.fn();
    res.on = jest.fn();
    res.statusCode = 200;
    return res;
}
/** Plain mock Express Request, no auth header. */
function createMockRequest(overrides = {}) {
    const { user, userId, ...rest } = overrides;
    const req = { headers: {}, ...rest };
    if (user || userId) {
        req.user = { id: userId ?? 'test-user-1', ...user };
    }
    return req;
}
/**
 * Builds on createMockRequest: auto-populates headers.authorization from
 * generateAuthToken(userId, user) and sets req.user, following the
 * authenticated-request pattern from UploadController.test.ts.
 */
function createAuthenticatedRequest(overrides = {}) {
    const userId = overrides.userId ?? 'test-user-1';
    const user = { id: userId, ...overrides.user };
    const token = (0, auth_1.generateAuthToken)(userId, overrides.user);
    const req = createMockRequest({ ...overrides, userId, user });
    req.headers = { ...req.headers, authorization: `Bearer ${token}`, ...overrides.headers };
    return req;
}
