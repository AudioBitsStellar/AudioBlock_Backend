import { validate } from "class-validator";
import { JWTDTO } from "../dtos/JWTDTO";
import { RegisterWithEmailDTO } from "../dtos/RegisterWithEmailDTO";
import { LoginWithEmailDTO } from "../dtos/LoginWithEmailDTO";
import { Repository } from "typeorm";
import { User } from "../entities/User";
import AppDataSource from "../config/db";
import jwt from "jsonwebtoken";
import redis from "../config/redis";
import { randomBytes } from "crypto";
import bcrypt from "bcrypt";
import { generateSecret, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";
import { EmailService } from "./EmailService";

const PASSWORD_SALT_ROUNDS = 12;
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_BYTES = 5;

type LoginWithEmailResult =
  | { user: User; token: string; twoFactorRequired?: false }
  | { twoFactorRequired: true; user: Pick<User, "id" | "email" | "role"> };

export class AuthService {
  private userRepo: Repository<User>;
  private emailService: EmailService;

  constructor() {
    this.userRepo = AppDataSource.getRepository(User);
    this.emailService = new EmailService();
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
      emailVerified: user.emailVerified ?? (user.passwordHash ? false : undefined),
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
    const verificationToken = this.emailService.generateVerificationToken();
    const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const user = this.userRepo.create({
      email: dto.email,
      passwordHash,
      role: dto.role,
      username: dto.username,
      name: dto.name,
      emailVerificationToken: verificationToken,
      emailVerificationTokenExpiry: tokenExpiry,
      emailVerified: false,
    });
    const savedUser = await this.userRepo.save(user);

    const appUrl = process.env.APP_URL || "http://localhost:3000";
    await this.emailService.sendEmail(
      dto.email,
      "Verify your email",
      `<p>Please click <a href="${appUrl}/verify-email/${verificationToken}">here</a> to verify your email.</p>`
    );

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

  async verifyEmail(token: string): Promise<User> {
    const user = await this.userRepo.findOne({
      where: { emailVerificationToken: token },
    });

    if (!user) {
      throw new Error("Invalid verification token");
    }

    if (user.emailVerificationTokenExpiry && user.emailVerificationTokenExpiry < new Date()) {
      throw new Error("Verification token has expired");
    }

    user.emailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationTokenExpiry = undefined;
    return this.userRepo.save(user);
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.userRepo.findOneBy({ email });
    if (!user) return;

    const resetToken = this.emailService.generateResetToken();
    const tokenExpiry = new Date(Date.now() + 30 * 60 * 1000);

    user.passwordResetToken = resetToken;
    user.passwordResetTokenExpiry = tokenExpiry;
    await this.userRepo.save(user);

    const appUrl = process.env.APP_URL || "http://localhost:3000";
    await this.emailService.sendEmail(
      email,
      "Reset your password",
      `<p>Please click <a href="${appUrl}/reset-password/${resetToken}">here</a> to reset your password. This link expires in 30 minutes.</p>`
    );
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const user = await this.userRepo.findOne({
      where: { passwordResetToken: token },
    });

    if (!user) {
      throw new Error("Invalid reset token");
    }

    if (user.passwordResetTokenExpiry && user.passwordResetTokenExpiry < new Date()) {
      throw new Error("Reset token has expired");
    }

    user.passwordHash = await bcrypt.hash(newPassword, PASSWORD_SALT_ROUNDS);
    user.passwordResetToken = undefined;
    user.passwordResetTokenExpiry = undefined;
    await this.userRepo.save(user);
  }
}
