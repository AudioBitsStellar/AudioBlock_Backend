import 'reflect-metadata';

jest.mock('axios');

import axios from 'axios';
import { EmailService } from '../services/EmailService';

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('EmailService.generateResetToken', () => {
  it('returns a URL-safe (base64url) token with 32 bytes of entropy', () => {
    const svc = new EmailService();
    const token = svc.generateResetToken();

    // base64url alphabet only — no +, /, or = padding.
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 bytes → 43 base64url characters (unpadded).
    expect(token).toHaveLength(43);
  });

  it('returns a unique token on each call', () => {
    const svc = new EmailService();
    expect(svc.generateResetToken()).not.toBe(svc.generateResetToken());
  });
});

describe('EmailService.generateVerificationToken', () => {
  it('returns a 64-character hex token', () => {
    const svc = new EmailService();
    expect(svc.generateVerificationToken()).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('EmailService.sendEmail', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('skips sending and does not call the provider when no API key is configured', async () => {
    delete process.env.EMAIL_API_KEY;
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const svc = new EmailService();
    await svc.sendEmail('to@b.com', 'Subject', '<p>hi</p>');

    expect(mockedAxios.post).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('posts to Resend when the provider is resend', async () => {
    process.env.EMAIL_API_KEY = 'key';
    process.env.EMAIL_PROVIDER = 'resend';
    mockedAxios.post.mockResolvedValue({ data: {} } as never);

    const svc = new EmailService();
    await svc.sendEmail('to@b.com', 'Subject', '<p>hi</p>');

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://api.resend.com/v1/emails',
      expect.objectContaining({ to: 'to@b.com', subject: 'Subject' }),
      expect.any(Object),
    );
  });

  it('posts to SendGrid when the provider is sendgrid', async () => {
    process.env.EMAIL_API_KEY = 'key';
    process.env.EMAIL_PROVIDER = 'sendgrid';
    mockedAxios.post.mockResolvedValue({ data: {} } as never);

    const svc = new EmailService();
    await svc.sendEmail('to@b.com', 'Subject', '<p>hi</p>');

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://api.sendgrid.com/v3/mail/send',
      expect.objectContaining({ subject: 'Subject' }),
      expect.any(Object),
    );
  });
});
