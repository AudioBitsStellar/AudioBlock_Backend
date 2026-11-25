import { Request, Response } from 'express';
import { AuthController } from '../AuthController';
import { AppError } from '../../errors/AppError';

const mockRegisterWithEmail = jest.fn();
const mockLoginWithEmail = jest.fn();
const mockLogin = jest.fn();
const mockRefreshToken = jest.fn();
const mockLogout = jest.fn();
const mockForgotPassword = jest.fn();
const mockGetNonce = jest.fn();
const mockEnableTwoFactor = jest.fn();
const mockVerifyTwoFactor = jest.fn();
const mockDisableTwoFactor = jest.fn();
const mockCompleteTwoFactorLogin = jest.fn();
const mockVerifyEmail = jest.fn();
const mockResendVerificationEmail = jest.fn();
const mockResetPassword = jest.fn();
const mockIntrospectToken = jest.fn();
const mockPrivyLogin = jest.fn();
const mockPrivyRefreshToken = jest.fn();
const mockPrivyLogout = jest.fn();
const mockCreateUser = jest.fn();

jest.mock('../../services/AuthService', () => ({
  AuthService: jest.fn().mockImplementation(() => ({
    registerWithEmail: mockRegisterWithEmail,
    loginWithEmail: mockLoginWithEmail,
    login: mockLogin,
    refreshToken: mockRefreshToken,
    logout: mockLogout,
    forgotPassword: mockForgotPassword,
    getNonce: mockGetNonce,
    enableTwoFactor: mockEnableTwoFactor,
    verifyTwoFactor: mockVerifyTwoFactor,
    disableTwoFactor: mockDisableTwoFactor,
    completeTwoFactorLogin: mockCompleteTwoFactorLogin,
    verifyEmail: mockVerifyEmail,
    resendVerificationEmail: mockResendVerificationEmail,
    resetPassword: mockResetPassword,
    introspectToken: mockIntrospectToken,
    privyLogin: mockPrivyLogin,
    privyRefreshToken: mockPrivyRefreshToken,
    privyLogout: mockPrivyLogout,
  })),
}));

jest.mock('../../services/UserService', () => ({
  UserService: jest.fn().mockImplementation(() => ({ createUser: mockCreateUser })),
}));
jest.mock('../../config/redis', () => ({
  __esModule: true,
  default: {
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
  },
}));

function createRequest(
  body: Record<string, unknown> = {},
  params: Record<string, string> = {},
  extra: Record<string, unknown> = {},
) {
  return { body, params, path: '/auth/test', id: 'test-request', ...extra } as unknown as Request;
}

function createResponse() {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
    clearCookie: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  res.clearCookie.mockReturnValue(res);
  return res as unknown as Response & {
    status: jest.Mock;
    json: jest.Mock;
    clearCookie: jest.Mock;
  };
}

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AuthController();
  });

  it('returns login tokens in the documented response shape', async () => {
    const result = {
      user: { id: 'user-1', email: 'artist@example.com' },
      token: 'access-token',
      refreshToken: 'refresh-token',
    };
    mockLoginWithEmail.mockResolvedValue(result);
    const res = createResponse();

    await controller.loginWithEmail(
      createRequest({ email: 'artist@example.com', password: 'password123' }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, ...result }));
  });

  it('returns the requested nonce message', async () => {
    mockGetNonce.mockResolvedValue('nonce-value');
    const res = createResponse();

    await controller.getUserNonce(createRequest({}, { email: 'artist@example.com' }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Audioblocks Login\nNonce: nonce-value\nEmail: artist@example.com',
    });
  });

  it('registers a wallet user after DTO validation', async () => {
    mockCreateUser.mockResolvedValue({ id: 'user-1' });
    const res = createResponse();

    await controller.register(
      createRequest({
        dynamixUserId: 'dynamic-1',
        role: 'listener',
        walletAddress: 'GABC',
        signature: 'sig',
        message: 'nonce message',
        email: 'artist@example.com',
        username: 'artist',
      }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockCreateUser).toHaveBeenCalledTimes(1);
  });

  it('registers a listener with a valid wallet DTO', async () => {
    mockCreateUser.mockResolvedValue({ id: 'listener-1' });
    const res = createResponse();

    await controller.registerListener(
      createRequest({
        dynamixUserId: 'dynamic-1',
        role: 'listener',
        walletAddress: 'GABC',
        signature: 'sig',
        message: 'nonce message',
        email: 'listener@example.com',
      }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('returns a successful legacy wallet login response', async () => {
    mockLogin.mockResolvedValue({ id: 'user-1', token: 'access-token' });
    const res = createResponse();

    await controller.login(
      createRequest({
        role: 'listener',
        walletAddress: 'GABC',
        signature: 'sig',
        message: 'nonce message',
        email: 'artist@example.com',
      }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('registers a user with valid email credentials', async () => {
    mockRegisterWithEmail.mockResolvedValue({
      user: { id: 'user-1' },
      token: 'access-token',
      refreshToken: 'refresh-token',
    });
    const res = createResponse();

    await controller.registerWithEmail(
      createRequest({
        email: 'artist@example.com',
        password: 'password123',
        role: 'artist',
        dateOfBirth: '1990-01-01',
      }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('returns a generic 401 for wallet login failures', async () => {
    mockLogin.mockRejectedValue(new Error('Invalid or expired nonce'));
    const res = createResponse();

    await controller.login(
      createRequest({
        role: 'listener',
        walletAddress: 'GABC',
        signature: 'invalid-signature',
        message: 'Audioblocks Login\nNonce: expired',
        email: 'artist@example.com',
      }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: 'Invalid wallet credentials' }),
    );
    expect(JSON.stringify(res.json.mock.calls)).not.toMatch(
      /not found|wrong password|expired nonce/i,
    );
  });

  it('uses the same generic 401 response for an incorrect email password', async () => {
    mockLoginWithEmail.mockRejectedValue(AppError.authentication('Invalid email or password'));
    const res = createResponse();

    await controller.loginWithEmail(
      createRequest({ email: 'artist@example.com', password: 'wrong-password' }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Invalid email or password' }),
    );
    expect(JSON.stringify(res.json.mock.calls)).not.toMatch(/user not found|wrong password/i);
  });

  it('returns 409 when registration email is already in use', async () => {
    mockRegisterWithEmail.mockRejectedValue(AppError.conflict('User already exists'));
    const res = createResponse();

    await controller.registerWithEmail(
      createRequest({
        email: 'artist@example.com',
        password: 'password123',
        role: 'artist',
        dateOfBirth: '1990-01-01',
      }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('returns 400 with field errors for an invalid registration DTO', async () => {
    const res = createResponse();

    await controller.registerWithEmail(createRequest({ email: 'invalid' }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        details: expect.arrayContaining([
          expect.objectContaining({ field: 'email' }),
          expect.objectContaining({ field: 'password' }),
          expect.objectContaining({ field: 'role' }),
        ]),
      }),
    );
    expect(mockRegisterWithEmail).not.toHaveBeenCalled();
  });

  it.each(['Invalid signature', 'Invalid or expired nonce', 'User not found'])(
    'returns 401 for wallet authentication failure: %s',
    async (failure) => {
      mockLogin.mockRejectedValue(new Error(failure));
      const res = createResponse();

      await controller.login(
        createRequest({
          role: 'listener',
          walletAddress: 'GABC',
          signature: 'signature',
          message: 'Audioblocks Login\nNonce: value',
          email: 'artist@example.com',
        }),
        res,
      );

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Invalid wallet credentials' }),
      );
    },
  );

  it('returns 401 if the refresh token is missing', async () => {
    const res = createResponse();

    await controller.refreshToken(createRequest(), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockRefreshToken).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid refresh-token errors', async () => {
    mockRefreshToken.mockRejectedValue(new Error('refresh backend error'));
    const res = createResponse();

    await controller.refreshToken(createRequest({ refreshToken: 'bad' }), res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 401 for an invalid refresh token', async () => {
    mockRefreshToken.mockRejectedValue(AppError.authentication('Invalid refresh token'));
    const res = createResponse();

    await controller.refreshToken(createRequest({ refreshToken: 'invalid' }), res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns rotated tokens on refresh success', async () => {
    const rotated = { token: 'new-access', refreshToken: 'new-refresh' };
    mockRefreshToken.mockResolvedValue(rotated);
    const res = createResponse();

    await controller.refreshToken(createRequest({ refreshToken: 'old-refresh' }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining(rotated));
  });

  it('clears token cookies on logout', async () => {
    mockLogout.mockResolvedValue(undefined);
    const res = createResponse();

    await controller.logout(createRequest({ refreshToken: 'refresh-token' }), res);

    expect(res.clearCookie).toHaveBeenCalledWith('token');
    expect(res.clearCookie).toHaveBeenCalledWith('refreshToken');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rejects enabling 2FA without an authenticated user and enables it for a user', async () => {
    const unauthorized = createResponse();
    await controller.enableTwoFactor(createRequest(), unauthorized);
    expect(unauthorized.status).toHaveBeenCalledWith(401);

    mockEnableTwoFactor.mockResolvedValue({ secret: 'secret', qrCode: 'qr' });
    const success = createResponse();
    await controller.enableTwoFactor(createRequest({}, {}, { user: { id: 'user-1' } }), success);
    expect(success.status).toHaveBeenCalledWith(200);
  });

  it('handles 2FA verification authorization, validation, and success paths', async () => {
    const unauthorized = createResponse();
    await controller.verifyTwoFactor(createRequest({ code: '123456' }), unauthorized);
    expect(unauthorized.status).toHaveBeenCalledWith(401);

    const missingCode = createResponse();
    await controller.verifyTwoFactor(
      createRequest({}, {}, { user: { id: 'user-1' } }),
      missingCode,
    );
    expect(missingCode.status).toHaveBeenCalledWith(400);

    mockVerifyTwoFactor.mockResolvedValue(undefined);
    const success = createResponse();
    await controller.verifyTwoFactor(
      createRequest({ code: '123456' }, {}, { user: { id: 'user-1' } }),
      success,
    );
    expect(success.status).toHaveBeenCalledWith(200);
  });

  it('handles 2FA disable and validation endpoints', async () => {
    const unauthorized = createResponse();
    await controller.disableTwoFactor(createRequest({ code: '123456' }), unauthorized);
    expect(unauthorized.status).toHaveBeenCalledWith(401);

    const missingCode = createResponse();
    await controller.disableTwoFactor(
      createRequest({}, {}, { user: { id: 'user-1' } }),
      missingCode,
    );
    expect(missingCode.status).toHaveBeenCalledWith(400);

    mockDisableTwoFactor.mockResolvedValue(undefined);
    const disabled = createResponse();
    await controller.disableTwoFactor(
      createRequest({ code: '123456' }, {}, { user: { id: 'user-1' } }),
      disabled,
    );
    expect(disabled.status).toHaveBeenCalledWith(200);

    const missingToken = createResponse();
    await controller.validateTwoFactor(createRequest({ code: '123456' }), missingToken);
    expect(missingToken.status).toHaveBeenCalledWith(400);

    mockCompleteTwoFactorLogin.mockResolvedValue({ token: 'access-token' });
    const validated = createResponse();
    await controller.validateTwoFactor(
      createRequest({ partialToken: 'partial', code: '123456' }),
      validated,
    );
    expect(validated.status).toHaveBeenCalledWith(200);
  });

  it('verifies email and returns generic resend responses', async () => {
    mockVerifyEmail.mockResolvedValue(undefined);
    const verified = createResponse();
    await controller.verifyEmail(createRequest({}, { token: 'verify-token' }), verified);
    expect(verified.status).toHaveBeenCalledWith(200);

    const missingEmail = createResponse();
    await controller.resendVerificationEmail(createRequest({ email: '' }), missingEmail);
    expect(missingEmail.status).toHaveBeenCalledWith(400);

    mockResendVerificationEmail.mockResolvedValue(undefined);
    const resent = createResponse();
    await controller.resendVerificationEmail(
      createRequest({ email: 'artist@example.com' }),
      resent,
    );
    expect(resent.status).toHaveBeenCalledWith(200);
  });

  it('always responds successfully to password reset requests for unknown emails', async () => {
    mockForgotPassword.mockResolvedValue(undefined);
    const res = createResponse();

    await controller.forgotPassword(createRequest({ email: 'unknown@example.com' }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: 'If the email exists, a reset link has been sent',
      }),
    );
  });

  it('validates reset-password input and completes a valid reset', async () => {
    const missingPassword = createResponse();
    await controller.resetPassword(createRequest({}, { token: 'reset-token' }), missingPassword);
    expect(missingPassword.status).toHaveBeenCalledWith(400);

    mockResetPassword.mockResolvedValue(undefined);
    const success = createResponse();
    await controller.resetPassword(
      createRequest({ password: 'new-password' }, { token: 'reset-token' }),
      success,
    );
    expect(success.status).toHaveBeenCalledWith(200);
  });

  it('returns introspection status and always responds 200 for invalid token input', async () => {
    const inactive = createResponse();
    await controller.introspect(createRequest({}), inactive);
    expect(inactive.status).toHaveBeenCalledWith(200);
    expect(inactive.json).toHaveBeenCalledWith({ active: false });

    mockIntrospectToken.mockResolvedValue({ active: true, sub: 'user-1' });
    const active = createResponse();
    await controller.introspect(createRequest({ token: 'valid-token' }), active);
    expect(active.json).toHaveBeenCalledWith({ active: true, sub: 'user-1' });
  });

  it('handles Privy login, refresh, and logout authentication paths', async () => {
    const missingToken = createResponse();
    await controller.privyLogin(createRequest({}), missingToken);
    expect(missingToken.status).toHaveBeenCalledWith(400);

    mockPrivyLogin.mockResolvedValue({ token: 'privy-token' });
    const login = createResponse();
    await controller.privyLogin(createRequest({ idToken: 'id-token' }), login);
    expect(login.status).toHaveBeenCalledWith(200);

    const missingRefresh = createResponse();
    await controller.privyRefreshToken(createRequest({ refreshToken: 'refresh' }), missingRefresh);
    expect(missingRefresh.status).toHaveBeenCalledWith(401);

    mockPrivyRefreshToken.mockResolvedValue({ token: 'rotated' });
    const refresh = createResponse();
    await controller.privyRefreshToken(
      createRequest({ refreshToken: 'refresh' }, {}, { privyUser: { id: 'user-1' } }),
      refresh,
    );
    expect(refresh.status).toHaveBeenCalledWith(200);

    const missingUser = createResponse();
    await controller.privyLogout(createRequest(), missingUser);
    expect(missingUser.status).toHaveBeenCalledWith(401);

    mockPrivyLogout.mockResolvedValue(undefined);
    const logout = createResponse();
    await controller.privyLogout(createRequest({}, {}, { user: { id: 'user-1' } }), logout);
    expect(logout.status).toHaveBeenCalledWith(200);
  });
});
