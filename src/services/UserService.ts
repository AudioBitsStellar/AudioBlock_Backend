import { Repository } from 'typeorm';
import AppDataSource from '../config/db';
import { User, UserRole } from '../entities/User';
import { CreateUserDTO } from '../dtos/CreateUserDTO';
import { verifyMessage } from 'ethers';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import redis from '../config/redis';
import { TransactionLog } from '../entities/TransactionLog';
import { AppError } from '../errors/AppError';
import {
  validateRequired,
  validateEmail,
  validateUsername,
  validateEthereumAddress,
} from '../validators/ServiceValidator';
import {
  ERROR_MESSAGES,
  JWT_EXPIRATION,
  TRANSACTION_ACTIONS,
  REGEX_PATTERNS,
} from '../config/constants';

export class UserService {
  private userRepo: Repository<User>;
  private transactionLogRepo: Repository<TransactionLog>;

  constructor() {
    this.userRepo = AppDataSource.getRepository(User);
    this.transactionLogRepo = AppDataSource.getRepository(TransactionLog);
    dotenv.config();
  }

  /**
   * Register a new user via wallet-signature authentication.
   * Verifies the Ethereum signature, validates the nonce from Redis, creates
   * the user record, logs the transaction, and issues a JWT.
   *
   * @param data - CreateUserDTO with email, walletAddress, signature, message, and role.
   * @returns Created User entity and JWT token.
   * @throws {AppError} If signature invalid, nonce expired/mismatch, or user already exists.
   */
  async createUser(data: CreateUserDTO): Promise<{ user: User; token: string }> {
    // Service-layer input validation
    validateRequired(data.email, 'email');
    validateRequired(data.walletAddress, 'walletAddress');
    validateRequired(data.signature, 'signature');
    validateRequired(data.message, 'message');

    validateEmail(data.email);
    validateEthereumAddress(data.walletAddress);

    const dto = Object.assign(new CreateUserDTO(), data);

    const recoveredAddress = verifyMessage(dto.message, dto.signature);

    if (recoveredAddress.toLowerCase() !== dto.walletAddress.toLowerCase()) {
      throw AppError.authentication(ERROR_MESSAGES.INVALID_SIGNATURE);
    }

    // Extract and validate nonce from message
    const nonceMatch = dto.message.match(REGEX_PATTERNS.NONCE_IN_MESSAGE);

    if (!nonceMatch) {
      throw AppError.validation(ERROR_MESSAGES.NONCE_MISSING);
    }
    const nonce = nonceMatch[1];

    // Verify nonce exists and matches stored one
    const storedNonce = await redis.get(`nonce:${dto.email}`);

    if (!storedNonce) {
      throw AppError.authentication(ERROR_MESSAGES.NONCE_EXPIRED);
    }

    if (storedNonce !== nonce) {
      throw AppError.authentication(ERROR_MESSAGES.NONCE_MISMATCH);
    }

    //  Delete nonce immediately (one-time use)
    await redis.del(`nonce:${dto.email}`);

    // Check if user already exists
    const existingUser = await this.userRepo.findOneBy({
      walletAddress: dto.walletAddress,
    });
    if (existingUser) {
      throw AppError.conflict(ERROR_MESSAGES.USER_ALREADY_EXISTS);
    }

    const user = this.userRepo.create(dto);
    const savedUser = await this.userRepo.save(user);

    const log = this.transactionLogRepo.create({
      user_id: savedUser.id,
      txHash: '',
      action: TRANSACTION_ACTIONS.CREATE_USER,
      description: `User with wallet ${savedUser.walletAddress} created.`,
    });
    await this.transactionLogRepo.save(log);

    const token = this.generateToken(savedUser);

    return { user: savedUser, token };
  }

  /**
   * Look up a user by their Ethereum wallet address.
   *
   * @param walletAddress - The Ethereum wallet address to search for.
   * @returns Matching User entity or null if not found.
   * @throws {Error} If walletAddress is invalid.
   */
  async getUserByWalletAddress(walletAddress: string): Promise<User | null> {
    validateRequired(walletAddress, 'walletAddress');
    validateEthereumAddress(walletAddress);

    return await this.userRepo.findOneBy({ walletAddress });
  }

  /**
   * Retrieve all users from the database.
   *
   * @returns Array of all User entities.
   */
  async getAllUsers(): Promise<User[]> {
    return await this.userRepo.find();
  }

  /**
   * Look up a user by their unique ID.
   *
   * @param id - The user's UUID.
   * @returns Matching User entity or null if not found.
   */
  async getUserById(id: string): Promise<User | null> {
    validateRequired(id, 'id');

    return await this.userRepo.findOneBy({ id });
  }

  /**
   * Assign a role to a user (Issue #100). Used by the admin role-management
   * endpoint to promote/demote users across the RBAC role set.
   *
   * @param id - The target user's UUID.
   * @param role - The role to assign.
   * @returns The updated User entity.
   * @throws {AppError} If the user does not exist.
   */
  async assignRole(id: string, role: UserRole): Promise<User> {
    validateRequired(id, 'id');
    validateRequired(role, 'role');

    const user = await this.userRepo.findOneBy({ id });
    if (!user) {
      throw AppError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);
    }

    user.role = role;
    return await this.userRepo.save(user);
  }

  /**
   * Update a user's profile fields. Validates uniqueness constraints for
   * walletAddress, email, and username before saving.
   *
   * @param id - The user's UUID.
   * @param data - Partial User fields to update.
   * @returns Updated User entity.
   * @throws {AppError} If user not found or uniqueness constraint violated.
   */
  async updateUser(id: string, data: Partial<User>): Promise<User | null> {
    validateRequired(id, 'id');

    const user = await this.userRepo.findOneBy({ id });
    if (!user) {
      throw AppError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);
    }

    // Validate uniqueness constraints
    if (data.walletAddress && data.walletAddress !== user.walletAddress) {
      validateEthereumAddress(data.walletAddress);
      const existingUser = await this.userRepo.findOneBy({
        walletAddress: data.walletAddress,
      });
      if (existingUser) {
        throw AppError.conflict(ERROR_MESSAGES.WALLET_ADDRESS_ALREADY_EXISTS);
      }
    }

    if (data.email && data.email !== user.email) {
      validateEmail(data.email);
      const existingUser = await this.userRepo.findOneBy({ email: data.email });
      if (existingUser) {
        throw AppError.conflict(ERROR_MESSAGES.EMAIL_ALREADY_EXISTS);
      }
    }

    if (data.username && data.username !== user.username) {
      validateUsername(data.username);
      const existingUser = await this.userRepo.findOneBy({
        username: data.username,
      });
      if (existingUser) {
        throw AppError.conflict(ERROR_MESSAGES.USERNAME_ALREADY_EXISTS);
      }
    }

    Object.assign(user, data);
    return await this.userRepo.save(user);
  }

  /**
   * Permanently delete a user from the database.
   *
   * @param id - The user's UUID.
   * @returns The removed User entity.
   * @throws {AppError} If user not found.
   */
  async deleteUser(id: string): Promise<User | null> {
    validateRequired(id, 'id');

    const user = await this.userRepo.findOneBy({ id });
    if (!user) {
      throw AppError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);
    }
    return await this.userRepo.remove(user);
  }

  /**
   * Generate JWT token for user (extracted to avoid duplication)
   */
  private generateToken(user: User): string {
    const JWT_SECRET = process.env.JWT_SECRET;
    if (!JWT_SECRET) {
      throw AppError.businessLogic(ERROR_MESSAGES.JWT_SECRET_NOT_SET);
    }

    const payload = {
      id: user.id,
      dynamixUserId: user.dynamixUserId,
      email: user.email,
      walletAddress: user.walletAddress,
      role: user.role,
      username: user.username,
      profileImage: user.profileImage,
      name: user.name,
      rewardPoints: user.rewardPoints,
      totalStreams: user.totalStreams,
      totalStreamTime: user.totalStreamTime,
      uniqueListeners: user.uniqueListeners,
    };

    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRATION });
  }
}
