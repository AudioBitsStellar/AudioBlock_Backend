"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertSuccessResponse = assertSuccessResponse;
exports.assertErrorResponse = assertErrorResponse;
function lastJsonPayload(res) {
    const calls = res.json.mock.calls;
    if (calls.length === 0) {
        throw new Error('assertResponse: res.json was never called');
    }
    return calls[calls.length - 1][0];
}
/**
 * Validates a standard success response: { success: true, message, ...data }.
 */
function assertSuccessResponse(res, expected = {}) {
    if (expected.status !== undefined) {
        expect(res.status).toHaveBeenCalledWith(expected.status);
    }
    const payload = lastJsonPayload(res);
    expect(payload.success).toBe(true);
    expect(typeof payload.message).toBe('string');
    if (expected.message !== undefined) {
        expect(payload.message).toBe(expected.message);
    }
    if (expected.data) {
        expect(payload).toMatchObject(expected.data);
    }
}
/**
 * Validates a standard error response. Tolerant of this codebase's two
 * error shapes: { success: false, message } (AppError) and a bare
 * { message } with no `success` key at all (generic handleError fallback
 * for plain Error/string) — only asserts success === false when that key
 * is actually present.
 */
function assertErrorResponse(res, expected = {}) {
    if (expected.status !== undefined) {
        expect(res.status).toHaveBeenCalledWith(expected.status);
    }
    const payload = lastJsonPayload(res);
    if ('success' in payload) {
        expect(payload.success).toBe(false);
    }
    const messageText = payload.message ?? payload.error;
    expect(typeof messageText).toBe('string');
    if (expected.message !== undefined) {
        if (expected.message instanceof RegExp) {
            expect(messageText).toMatch(expected.message);
        }
        else {
            expect(messageText).toBe(expected.message);
        }
    }
}
