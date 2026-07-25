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
import { formatValidationErrors, handleError } from '../utils/helpers';
import redis from '../config/redis';
import logger from '../config/logger';

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
        return res.status(400).json({
          success: false,
          message: 'Request body is required',
        });
      }

      // Check for required fields before transformation
      const requiredFields = ['role', 'walletAddress', 'signature', 'message', 'email', 'username'];
      const missingFields = requiredFields.filter((field) => !req.body[field]);

      if (missingFields.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Missing required fields: ${missingFields.join(', ')}`,
        });
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
        const formatted = formatValidationErrors(errors);
        return res.status(422).json(formatted);
      }

      // Create user
      const user = await this.userService.createUser(userData);
      res.status(201).json({ success: true, message: 'User created successfully', user });
    } catch (error) {
      logger.error({ reqId: (req as any).id, route: req.path, err: error }, 'register error');
      this.handleError(res, error);
    }
  };

  registerListener = async (req: Request, res: Response) => {
    try {
      if (!req.body || Object.keys(req.body).length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Request body is required',
        });
      }

      // Check for required fields before transformation
      const requiredFields = ['role', 'walletAddress', 'signature', 'message', 'email'];
      const missingFields = requiredFields.filter((field) => !req.body[field]);

      if (missingFields.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Missing required fields: ${missingFields.join(', ')}`,
        });
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
        const formatted = formatValidationErrors(errors);
        return res.status(422).json(formatted);
      }

      // Create user
      const user = await this.userService.createUser(userData);
      res.status(201).json({ success: true, message: 'User created successfully', user });
    } catch (error) {
      logger.error(
        { reqId: (req as any).id, route: req.path, err: error },
        'registerListener error',
      );
      this.handleError(res, error);
    }
  };

  login = async (req: Request, res: Response) => {
    try {
      if (!req.body || Object.keys(req.body).length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Request body is required',
        });
      }

      // Check for required fields before transformation
      const requiredFields = ['role', 'walletAddress', 'signature', 'message'];
      const missingFields = requiredFields.filter((field) => !req.body[field]);

      if (missingFields.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Missing required fields: ${missingFields.join(', ')}`,
        });
      }

      const loginData = plainToInstance(JWTDTO, req.body, {
        enableImplicitConversion: true,
      });

      const errors = await validate(loginData);
      if (errors.length > 0) {
        console.log('Validation errors:', errors);
        const formatted = formatValidationErrors(errors);
        return res.status(422).json(formatted);
      }
      const user = await this.authService.login(loginData);
      res.status(200).json({ success: true, message: 'User logged in successfully', user });
    } catch (error) {
      logger.error({ reqId: (req as any).id, route: req.path, err: error }, 'login error');
      this.handleError(res, error);
    }
  };

  registerWithEmail = async (req: Request, res: Response) => {
    try {
      const dto = plainToInstance(RegisterWithEmailDTO, req.body, {
        enableImplicitConversion: true,
      });

      const errors = await validate(dto);
      if (errors.length > 0) {
        const formatted = formatValidationErrors(errors);
        return res.status(422).json(formatted);
      }

      const result = await this.authService.registerWithEmail(dto);
      res.status(201).json({ success: true, message: 'User registered successfully', ...result });
    } catch (error) {
      logger.error(
        { reqId: (req as any).id, route: req.path, err: error },
        'registerWithEmail error',
      );
      this.handleError(res, error);
    }
  };

  loginWithEmail = async (req: Request, res: Response) => {
    try {
      const dto = plainToInstance(LoginWithEmailDTO, req.body, {
        enableImplicitConversion: true,
      });

      const errors = await validate(dto);
      if (errors.length > 0) {
        const formatted = formatValidationErrors(errors);
        return res.status(422).json(formatted);
      }

      const result = await this.authService.loginWithEmail(dto);
      res.status(200).json({ success: true, message: 'User logged in successfully', ...result });
    } catch (error) {
      logger.error({ reqId: (req as any).id, route: req.path, err: error }, 'loginWithEmail error');
      this.handleError(res, error);
    }
  };

  enableTwoFactor = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
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
      this.handleError(res, error);
    }
  };

  verifyEmail = async (req: Request, res: Response) => {
    try {
      const token = req.params.token as string;
      await this.authService.verifyEmail(token);
      res.status(200).json({ success: true, message: 'Email verified successfully' });
    } catch (error) {
      logger.error({ reqId: (req as any).id, route: req.path, err: error }, 'verifyEmail error');
      this.handleError(res, error);
    }
  };

  forgotPassword = async (req: Request, res: Response) => {
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ success: false, message: 'Email is required' });
      }
      await this.authService.forgotPassword(email);
      res
        .status(200)
        .json({ success: true, message: 'If the email exists, a reset link has been sent' });
    } catch (error) {
      logger.error({ reqId: (req as any).id, route: req.path, err: error }, 'forgotPassword error');
      this.handleError(res, error);
    }
  };

  resetPassword = async (req: Request, res: Response) => {
    try {
      const token = req.params.token as string;
      const { password } = req.body;
      if (!password) {
        return res.status(400).json({ success: false, message: 'Password is required' });
      }
      await this.authService.resetPassword(token, password);
      res.status(200).json({ success: true, message: 'Password reset successfully' });
    } catch (error) {
      logger.error({ reqId: (req as any).id, route: req.path, err: error }, 'resetPassword error');
      this.handleError(res, error);
    }
  };

  private handleError(res: Response, error: unknown): void {
    if (error instanceof Error) {
      logger.error({ err: error }, error.message);
      res.status(400).json({ message: error.message });
    } else if (typeof error === 'string') {
      logger.error({ err: error }, error);
      res.status(400).json({ message: error });
    } else {
      logger.error({ err: error }, 'Unknown error');
      res.status(500).json({ message: 'Internal server error' });
    }
  }
}
