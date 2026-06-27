import { validate } from "class-validator";
import { JWTDTO } from "../dtos/JWTDTO";
import { RegisterWithEmailDTO } from "../dtos/RegisterWithEmailDTO";
import { LoginWithEmailDTO } from "../dtos/LoginWithEmailDTO";
import { verifyMessage } from "ethers";
import { Repository } from "typeorm";
import { User } from "../entities/User";
import AppDataSource from "../config/db";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { profile } from "console";
import redis from "../config/redis";
import { randomBytes } from "crypto";
import bcrypt from "bcrypt";
import { generateSecret, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";

const PASSWORD_SALT_ROUNDS = 12;
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_BYTES = 5;

type LoginWithEmailResult =
  | { user: User; token: string; twoFactorRequired?: false }
  | { twoFactorRequired: true; user: Pick<User, "id" | "email" | "role"> };

export class AuthService {
  private userRepo: Repository<User>;

  constructor() {
    this.userRepo = AppDataSource.getRepository(User);
    dotenv.config();
  }

  private signToken(user: User): string {
    const JWT_SECRET = process.env.JWT_SECRET as string;
    if (!JWT_SECRET) {
      throw new Error("JWT_SECRET not set in environment variables");
    }

    const payload = {
      id: user.id,
      dynamixUserId: user.dynamixUserId,
      email: user.email,
      walletAddress: user.walletAddress,
      stellarPublicKey: user.stellarPublicKey,
      role: user.role,
      username: user.username,
      profileImage: user.profileImage,
      name: user.name,
      rewardPoints: user.rewardPoints,
      totalStreams: user.totalStreams,
      totalStreamTime: user.totalStreamTime,
      uniqueListeners: user.uniqueListeners,
    };

    return jwt.sign(payload, JWT_SECRET, { expiresIn: "1d" });
  }

  /** Registers a user with email + password instead of a wallet signature. */
  async registerWithEmail(data: RegisterWithEmailDTO): Promise<{ user: User; token: string }> {
    const dto = Object.assign(new RegisterWithEmailDTO(), data);
    const errors = await validate(dto);
    if (errors.length > 0) {
      throw new Error(errors.map((error) => Object.values(error.constraints || {}).join(", ")).join(", "));
    }

    if (await this.userRepo.findOneBy({ email: dto.email })) {
      throw new Error("User already exists");
    }

    const passwordHash = await bcrypt.hash(dto.password, PASSWORD_SALT_ROUNDS);

    const user = this.userRepo.create({
      email: dto.email,
      passwordHash,
      role: dto.role,
      username: dto.username,
      name: dto.name,
    });
    const savedUser = await this.userRepo.save(user);

    const token = this.signToken(savedUser);
    return { user: savedUser, token };
  }

  /** Logs in a user with email + password instead of a wallet signature. */
  async loginWithEmail(data: LoginWithEmailDTO): Promise<LoginWithEmailResult> {
    const dto = Object.assign(new LoginWithEmailDTO(), data);
    const errors = await validate(dto);
    if (errors.length > 0) {
      throw new Error(errors.map((error) => Object.values(error.constraints || {}).join(", ")).join(", "));
    }

    const user = await this.userRepo.findOneBy({ email: dto.email });
    if (!user || !user.passwordHash) {
      throw new Error("Invalid email or password");
    }

    const matches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!matches) {
      throw new Error("Invalid email or password");
    }

    if (user.twoFactorEnabled) {
      if (!dto.twoFactorCode && !dto.recoveryCode) {
        return {
          twoFactorRequired: true,
          user: { id: user.id, email: user.email, role: user.role },
        };
      }

      const verified = dto.twoFactorCode
        ? this.verifyTotpCode(user, dto.twoFactorCode)
        : await this.verifyAndConsumeRecoveryCode(user, dto.recoveryCode as string);

      if (!verified) {
        throw new Error("Invalid two-factor code");
      }
    }

    const token = this.signToken(user);
    return { user, token };
  }

  async enableTwoFactor(userId: string): Promise<{
    secret: string;
    otpauthUrl: string;
    qrCodeDataUrl: string;
    backupCodes: string[];
  }> {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) {
      throw new Error("User not found");
    }

    if (!user.passwordHash) {
      throw new Error("Two-factor authentication is only available for email/password accounts");
    }

    const secret = generateSecret();
    const label = user.email || user.username || user.id;
    const issuer = "AudioBlocks";
    const otpauthUrl = generateURI({ label, issuer, secret });
    const backupCodes = this.generateRecoveryCodes();
    const recoveryCodeHashes = await Promise.all(
      backupCodes.map((code) => bcrypt.hash(this.normalizeRecoveryCode(code), PASSWORD_SALT_ROUNDS)),
    );

    user.twoFactorEnabled = true;
    user.twoFactorSecret = secret;
    user.twoFactorRecoveryCodeHashes = recoveryCodeHashes;
    await this.userRepo.save(user);

    return {
      secret,
      otpauthUrl,
      qrCodeDataUrl: await QRCode.toDataURL(otpauthUrl),
      backupCodes,
    };
  }

  private verifyTotpCode(user: User, code: string): boolean {
    if (!user.twoFactorSecret) {
      return false;
    }

    return verifySync({
      token: code.replace(/\s/g, ""),
      secret: user.twoFactorSecret,
    }).valid;
  }

  private async verifyAndConsumeRecoveryCode(user: User, recoveryCode: string): Promise<boolean> {
    const hashes = user.twoFactorRecoveryCodeHashes || [];
    const normalized = this.normalizeRecoveryCode(recoveryCode);

    for (const hash of hashes) {
      if (await bcrypt.compare(normalized, hash)) {
        user.twoFactorRecoveryCodeHashes = hashes.filter((storedHash) => storedHash !== hash);
        await this.userRepo.save(user);
        return true;
      }
    }

    return false;
  }

  private generateRecoveryCodes(): string[] {
    return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
      const value = randomBytes(RECOVERY_CODE_BYTES).toString("hex").toUpperCase();
      return `${value.slice(0, 5)}-${value.slice(5)}`;
    });
  }

  private normalizeRecoveryCode(code: string): string {
    return code.trim().replace(/\s/g, "").toUpperCase();
  }

  async getNonce(email: string): Promise<any> {
    if (!email) {
      throw new Error("Email is required");
    }

    const nonce = randomBytes(16).toString("hex");

    // store nonce with 5-min expiry
    await redis.set(`nonce:${email}`, nonce, "EX", 300);

    console.log("Generated nonce:", nonce);
    console.log("Nonce from redis:", await redis.get(`nonce:${email}`));
    return nonce;
  }

  async login(data: JWTDTO): Promise<{ user: User; token: string }> {
    const dto = Object.assign(new JWTDTO(), data);
    const errors = await validate(dto);

    if (errors.length > 0) {
      throw new Error(errors.map((error) => error.constraints).join(", "));
    }

    if (dto.message) {
      const nonceMatch = dto.message.match(/Nonce: (\w+)/);
      if (!nonceMatch) throw new Error("Nonce missing in message");
      const nonce = nonceMatch[1];

      const storedNonce = await redis.get(`nonce:${dto.email}`);
      console.log("Stored nonce:", storedNonce);
      if (!storedNonce || storedNonce !== nonce) {
        throw new Error("Invalid or expired nonce");
      }

      // Delete nonce immediately (one-time use)
      await redis.del(`nonce:${dto.email}`);
    }

    const user = await this.userRepo.findOneBy({ email: dto.email });
    if (!user) {
      throw new Error("User not found");
    }

    const token = this.signToken(user);
    return { user, token };
  }
}
