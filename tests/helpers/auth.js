"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTestJwtSecret = getTestJwtSecret;
exports.generateAuthToken = generateAuthToken;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const DEFAULT_TEST_JWT_SECRET = 'test-secret';
/**
 * Ensures JWT_SECRET is set for the current process (defaults to
 * 'test-secret' if unset). Idempotent. Both AuthService.signToken and
 * authMiddleware.requireAuth read process.env.JWT_SECRET at call time,
 * so a single shared default keeps sign/verify consistent without every
 * test file re-declaring its own beforeAll/afterAll.
 */
function getTestJwtSecret() {
    if (!process.env.JWT_SECRET) {
        process.env.JWT_SECRET = DEFAULT_TEST_JWT_SECRET;
    }
    return process.env.JWT_SECRET;
}
/**
 * Signs a JWT matching the shape authMiddleware.requireAuth expects,
 * using the same JWT_SECRET it will read at verify time.
 */
function generateAuthToken(userId = 'test-user-1', overrides = {}) {
    const secret = getTestJwtSecret();
    const payload = { id: userId, ...overrides };
    return jsonwebtoken_1.default.sign(payload, secret, { expiresIn: '1h' });
}
