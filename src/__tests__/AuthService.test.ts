import "reflect-metadata";

// --- module mocks (hoisted before any imports) ---
jest.mock("../config/db", () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));
jest.mock("../config/redis", () => ({
  __esModule: true,
  default: { set: jest.fn(), get: jest.fn(), del: jest.fn() },
}));
jest.mock("bcrypt");
jest.mock("jsonwebtoken");
jest.mock("otplib", () => ({
  generateSecret: jest.fn().mockReturnValue("TOTPSECRET"),
  generateURI: jest.fn().mockReturnValue("otpauth://totp/AudioBlocks:a%40b.com?secret=TOTPSECRET"),
  verifySync: jest.fn().mockReturnValue({ valid: true }),
}));
jest.mock("qrcode", () => ({
  __esModule: true,
  default: { toDataURL: jest.fn().mockResolvedValue("data:image/png;base64,qr") },
}));

import AppDataSource from "../config/db";
import redis from "../config/redis";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { AuthService } from "../services/AuthService";
import { UserRole } from "../entities/User";

const mockUserRepo = {
  findOneBy: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  (AppDataSource.getRepository as jest.Mock).mockReturnValue(mockUserRepo);
});

describe("AuthService.registerWithEmail", () => {
  it("throws when the email is already taken", async () => {
    mockUserRepo.findOneBy.mockResolvedValue({ id: "existing" });
    const svc = new AuthService();
    await expect(
      svc.registerWithEmail({ email: "a@b.com", password: "password123", role: UserRole.ARTIST })
    ).rejects.toThrow("User already exists");
  });

  it("creates user with hashed password and returns a JWT", async () => {
    mockUserRepo.findOneBy.mockResolvedValue(null);
    (bcrypt.hash as jest.Mock).mockResolvedValue("hashed_pw");
    const created = { id: "u1", email: "a@b.com", role: UserRole.ARTIST, passwordHash: "hashed_pw" };
    mockUserRepo.create.mockReturnValue(created);
    mockUserRepo.save.mockResolvedValue(created);
    (jwt.sign as jest.Mock).mockReturnValue("jwt.token");
    process.env.JWT_SECRET = "test_secret";

    const svc = new AuthService();
    const { user, token } = await svc.registerWithEmail({
      email: "a@b.com",
      password: "password123",
      role: UserRole.ARTIST,
    });

    expect(bcrypt.hash).toHaveBeenCalledWith("password123", 12);
    expect(mockUserRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: "a@b.com", passwordHash: "hashed_pw" })
    );
    expect(token).toBe("jwt.token");
    expect(user).toBe(created);
  });

  it("throws on validation error (short password)", async () => {
    const svc = new AuthService();
    await expect(
      svc.registerWithEmail({ email: "a@b.com", password: "short", role: UserRole.ARTIST })
    ).rejects.toThrow();
  });
});

describe("AuthService.loginWithEmail", () => {
  it("throws when user does not exist", async () => {
    mockUserRepo.findOneBy.mockResolvedValue(null);
    const svc = new AuthService();
    await expect(
      svc.loginWithEmail({ email: "a@b.com", password: "password123" })
    ).rejects.toThrow("Invalid email or password");
  });

  it("throws when password does not match", async () => {
    mockUserRepo.findOneBy.mockResolvedValue({ id: "u1", passwordHash: "hashed" });
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    const svc = new AuthService();
    await expect(
      svc.loginWithEmail({ email: "a@b.com", password: "wrongpass" })
    ).rejects.toThrow("Invalid email or password");
  });

  it("returns user and token on valid credentials", async () => {
    const user = { id: "u1", email: "a@b.com", passwordHash: "hashed", role: UserRole.ARTIST };
    mockUserRepo.findOneBy.mockResolvedValue(user);
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (jwt.sign as jest.Mock).mockReturnValue("jwt.token");
    process.env.JWT_SECRET = "test_secret";

    const svc = new AuthService();
    const result = await svc.loginWithEmail({ email: "a@b.com", password: "password123" });

    if (result.twoFactorRequired) {
      throw new Error("Did not expect 2FA challenge");
    }
    expect(result.token).toBe("jwt.token");
    expect(result.user).toBe(user);
  });

  it("requires a second factor when 2FA is enabled", async () => {
    const user = {
      id: "u1",
      email: "a@b.com",
      passwordHash: "hashed",
      role: UserRole.ARTIST,
      twoFactorEnabled: true,
      twoFactorSecret: "SECRET",
    };
    mockUserRepo.findOneBy.mockResolvedValue(user);
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    const svc = new AuthService();
    const result = await svc.loginWithEmail({ email: "a@b.com", password: "password123" });

    expect(result).toEqual({
      twoFactorRequired: true,
      user: { id: "u1", email: "a@b.com", role: UserRole.ARTIST },
    });
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it("accepts and consumes a valid recovery code", async () => {
    const user = {
      id: "u1",
      email: "a@b.com",
      passwordHash: "hashed",
      role: UserRole.ARTIST,
      twoFactorEnabled: true,
      twoFactorRecoveryCodeHashes: ["hashed_recovery"],
    };
    mockUserRepo.findOneBy.mockResolvedValue(user);
    (bcrypt.compare as jest.Mock)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    mockUserRepo.save.mockResolvedValue(user);
    (jwt.sign as jest.Mock).mockReturnValue("jwt.token");
    process.env.JWT_SECRET = "test_secret";

    const svc = new AuthService();
    const result = await svc.loginWithEmail({
      email: "a@b.com",
      password: "password123",
      recoveryCode: "abcde-fghij",
    });

    expect(mockUserRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ twoFactorRecoveryCodeHashes: [] }),
    );
    expect(result).toEqual({ user, token: "jwt.token" });
  });
});

describe("AuthService.getNonce", () => {
  it("throws when email is missing", async () => {
    const svc = new AuthService();
    await expect(svc.getNonce("")).rejects.toThrow("Email is required");
  });

  it("stores nonce in redis with 5-minute TTL and returns it", async () => {
    (redis.set as jest.Mock).mockResolvedValue("OK");
    (redis.get as jest.Mock).mockResolvedValue("abc123");

    const svc = new AuthService();
    const nonce = await svc.getNonce("a@b.com");

    expect(typeof nonce).toBe("string");
    expect(nonce.length).toBeGreaterThan(0);
    expect(redis.set).toHaveBeenCalledWith(
      "nonce:a@b.com",
      expect.any(String),
      "EX",
      300
    );
  });
});

describe("AuthService.login (wallet-signature flow)", () => {
  it("throws on invalid or expired nonce", async () => {
    (redis.get as jest.Mock).mockResolvedValue(null);
    const svc = new AuthService();
    await expect(
      svc.login({ email: "a@b.com", message: "Sign in\nNonce: abc123", signature: "0xsig", role: "listener" })
    ).rejects.toThrow("Invalid or expired nonce");
  });

  it("returns user and token when nonce matches", async () => {
    (redis.get as jest.Mock).mockResolvedValue("abc123");
    (redis.del as jest.Mock).mockResolvedValue(1);
    const user = { id: "u1", email: "a@b.com", role: UserRole.ARTIST };
    mockUserRepo.findOneBy.mockResolvedValue(user);
    (jwt.sign as jest.Mock).mockReturnValue("jwt.token");
    process.env.JWT_SECRET = "test_secret";

    const svc = new AuthService();
    const result = await svc.login({
      email: "a@b.com",
      message: "Sign in\nNonce: abc123",
      signature: "0xsig",
      role: "artist",
    });

    expect(redis.del).toHaveBeenCalledWith("nonce:a@b.com");
    expect(result.token).toBe("jwt.token");
  });
});
