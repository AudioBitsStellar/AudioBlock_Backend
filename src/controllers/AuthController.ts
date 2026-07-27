import { plainToInstance } from 'class-transformer';
import { CreateUserDTO } from '../dtos/CreateUserDTO';
import { JWTDTO } from '../dtos/JWTDTO';
import { RegisterWithEmailDTO } from '../dtos/RegisterWithEmailDTO';
import { LoginWithEmailDTO } from '../dtos/LoginWithEmailDTO';
import { UpdateUserDTO } from '../dtos/UpdateUserDTO';
import { User } from '../entities/User';
import { AuthService } from '../services/AuthService';
import { UserService } from './../services/UserService';
import { Request, Response } from 'express';
import { validate } from 'class-validator';
import { handleError } from '../utils/helpers';
import { AppError } from '../errors/AppError';
import redis from '../config/redis';
import logger from '../config/logger';

function toValidationDetails(errors: { property: string; constraints?: Record<string, string> }[]) {
  return errors.map((err) => ({
    field: err.property,
    message: Object.values(err.constraints || {})[0] ?? 'Invalid value',
  }));
}

export class AuthController {
  private userService: UserService;
  private authService: AuthService;

  constructor() {
    this.userService = new UserService();
    this.authService = new AuthService();
  }

  getUserNonce = async (req: Request, res: Response) => {
    try {
      const email = Array.isArray(req.params.email) ? req.params.email[0] : req.params.email;
      const nonce = await this.authService.getNonce(email);
      res.status(200).json({
        success: true,
        message: `Audioblocks Login\nNonce: ${nonce}\nEmail: ${email}`,
      });
    } catch (error) {
      logger.error({ reqId: (req as any).id, route: req.path, err: error }, 'getUserNonce error');
      handleError(res, error);
    }
  };

  register = async (req: Request, res: Response) => {
    try {
      if (!req.body || Object.keys(req.body).length === 0) {
        throw AppError.validation('Request body is required');
      }

      // Check for required fields before transformation
      const requiredFields = ['role', 'walletAddress', 'signature', 'message', 'email', 'username'];
      const missingFields = requiredFields.filter((field) => !req.body[field]);

      if (missingFields.length > 0) {
        throw AppError.validation(`Missing required fields: ${missingFields.join(', ')}`);
      }

      // Transform with explicit options
      const userData = plainToInstance(CreateUserDTO, req.body, {
        enableImplicitConversion: true,
      });

      console.log('Transformed userData:', userData);

      // Validate the transformed data
      const errors = await validate(userData);
      if (errors.length > 0) {
        console.log('Validation errors:', errors);
        throw AppError.validation('Validation failed', toValidationDetails(errors));
      }

      // Create user
      const user = await this.userService.createUser(userData);
      res.status(201).json({ success: true, message: 'User created successfully', user });
    } catch (error) {
      logger.error({ reqId: (req as any).id, route: req.path, err: error }, 'register error');
      handleError(res, error);
    }
  };

  registerListener = async (req: Request, res: Response) => {
    try {
      if (!req.body || Object.keys(req.body).length === 0) {
        throw AppError.validation('Request body is required');
      }

      // Check for required fields before transformation
      const requiredFields = ['role', 'walletAddress', 'signature', 'message', 'email'];
      const missingFields = requiredFields.filter((field) => !req.body[field]);

      if (missingFields.length > 0) {
        throw AppError.validation(`Missing required fields: ${missingFields.join(', ')}`);
      }

      // Transform with explicit options
      const userData = plainToInstance(CreateUserDTO, req.body, {
        enableImplicitConversion: true,
      });

      console.log('Transformed userData:', userData);

      // Validate the transformed data
      const errors = await validate(userData);
      if (errors.length > 0) {
        console.log('Validation errors:', errors);
        throw AppError.validation('Validation failed', toValidationDetails(errors));
      }

      // Create user
      const user = await this.userService.createUser(userData);
      res.status(201).json({ success: true, message: 'User created successfully', user });
    } catch (error) {
      logger.error(
        { reqId: (req as any).id, route: req.path, err: error },
        'registerListener error',
      );
      handleError(res, error);
    }
  };

  login = async (req: Request, res: Response) => {
    try {
      if (!req.body || Object.keys(req.body).length === 0) {
        throw AppError.validation('Request body is required');
      }

      // Check for required fields before transformation
      const requiredFields = ['role', 'walletAddress', 'signature', 'message'];
      const missingFields = requiredFields.filter((field) => !req.body[field]);

      if (missingFields.length > 0) {
        throw AppError.validation(`Missing required fields: ${missingFields.join(', ')}`);
      }

      const loginData = plainToInstance(JWTDTO, req.body, {
        enableImplicitConversion: true,
      });

      const errors = await validate(loginData);
      if (errors.length > 0) {
        console.log('Validation errors:', errors);
        throw AppError.validation('Validation failed', toValidationDetails(errors));
      }
      const user = await this.authService.login(loginData);
      res.status(200).json({ success: true, message: 'User logged in successfully', user });
    } catch (error) {
      logger.error({ reqId: (req as any).id, route: req.path, err: error }, 'login error');
      handleError(res, error);
    }
  };

  registerWithEmail = async (req: Request, res: Response) => {
    try {
      const dto = plainToInstance(RegisterWithEmailDTO, req.body, {
        enableImplicitConversion: true,
      });

      const errors = await validate(dto);
      if (errors.length > 0) {
        throw AppError.validation('Validation failed', toValidationDetails(errors));
      }

      const result = await this.authService.registerWithEmail(dto);
      res.status(201).json({ success: true, message: 'User registered successfully', ...result });
    } catch (error) {
      logger.error(
        { reqId: (req as any).id, route: req.path, err: error },
        'registerWithEmail error',
      );
      handleError(res, error);
    }
  };

  loginWithEmail = async (req: Request, res: Response) => {
    try {
      const dto = plainToInstance(LoginWithEmailDTO, req.body, {
        enableImplicitConversion: true,
      });

      const errors = await validate(dto);
      if (errors.length > 0) {
        throw AppError.validation('Validation failed', toValidationDetails(errors));
      }

      const result = await this.authService.loginWithEmail(dto);
      res.status(200).json({ success: true, message: 'User logged in successfully', ...result });
    } catch (error) {
      logger.error({ reqId: (req as any).id, route: req.path, err: error }, 'loginWithEmail error');
      handleError(res, error);
    }
  };

  enableTwoFactor = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        throw AppError.authentication('Unauthorized');
      }

      const enrollment = await this.authService.enableTwoFactor(userId);
      res.status(200).json({
        success: true,
        message: 'Two-factor authentication enabled',
        ...enrollment,
      });
    } catch (error) {
      logger.error(
        { reqId: (req as any).id, route: req.path, err: error },
        'enableTwoFactor error',
      );
      handleError(res, error);
    }
  };

  verifyEmail = async (req: Request, res: Response) => {
    try {
      const token = req.params.token as string;
      await this.authService.verifyEmail(token);
      res.status(200).json({ success: true, message: 'Email verified successfully' });
    } catch (error) {
      logger.error({ reqId: (req as any).id, route: req.path, err: error }, 'verifyEmail error');
      handleError(res, error);
    }
  };

  forgotPassword = async (req: Request, res: Response) => {
    try {
      const { email } = req.body;
      if (!email) {
        throw AppError.validation('Email is required');
      }
      await this.authService.forgotPassword(email);
      res
        .status(200)
        .json({ success: true, message: 'If the email exists, a reset link has been sent' });
    } catch (error) {
      logger.error({ reqId: (req as any).id, route: req.path, err: error }, 'forgotPassword error');
      handleError(res, error);
    }
  };

  resetPassword = async (req: Request, res: Response) => {
    try {
      const token = req.params.token as string;
      const { password } = req.body;
      if (!password) {
        throw AppError.validation('Password is required');
      }
      await this.authService.resetPassword(token, password);
      res.status(200).json({ success: true, message: 'Password reset successfully' });
    } catch (error) {
      logger.error({ reqId: (req as any).id, route: req.path, err: error }, 'resetPassword error');
      handleError(res, error);
    }
  };
}
