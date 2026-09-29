import crypto from 'crypto';
import { PrivyWebhookService } from '../PrivyWebhookService';

describe('PrivyWebhookService', () => {
  const testSecret = 'test-webhook-secret-12345';
  const testPayload = JSON.stringify({ user_id: 'did:privy:test123', email: 'test@example.com' });

  function generateValidSignature(payload: string, timestamp: number, secret: string): string {
    const signedPayload = `${timestamp}.${payload}`;
    const signature = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
    return `t=${timestamp},v1=${signature}`;
  }

  describe('constructor', () => {
    it('should throw error if webhook secret is empty', () => {
      expect(() => new PrivyWebhookService('')).toThrow(
        'PRIVY_WEBHOOK_SECRET is required for webhook signature verification',
      );
    });

    it('should throw error if webhook secret is whitespace only', () => {
      expect(() => new PrivyWebhookService('   ')).toThrow(
        'PRIVY_WEBHOOK_SECRET is required for webhook signature verification',
      );
    });

    it('should trim and accept valid secret', () => {
      const service = new PrivyWebhookService('  valid-secret  ');
      expect(service).toBeInstanceOf(PrivyWebhookService);
    });
  });

  describe('verifySignature', () => {
    let service: PrivyWebhookService;

    beforeEach(() => {
      service = new PrivyWebhookService(testSecret);
    });

    it('should return false if signature header is missing', () => {
      const result = service.verifySignature(undefined, testPayload);
      expect(result).toBe(false);
    });

    it('should return false if signature header is malformed', () => {
      const result = service.verifySignature('invalid-signature-format', testPayload);
      expect(result).toBe(false);
    });

    it('should return false if timestamp is missing', () => {
      const result = service.verifySignature('v1=abcdef', testPayload);
      expect(result).toBe(false);
    });

    it('should return false if signature is missing', () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const result = service.verifySignature(`t=${timestamp}`, testPayload);
      expect(result).toBe(false);
    });

    it('should return false if webhook is too old', () => {
      const oldTimestamp = Math.floor(Date.now() / 1000) - 400; // > 5 minutes ago
      const signature = generateValidSignature(testPayload, oldTimestamp, testSecret);
      const result = service.verifySignature(signature, testPayload);
      expect(result).toBe(false);
    });

    it('should return false if webhook is from the future', () => {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 120; // 2 minutes in future
      const signature = generateValidSignature(testPayload, futureTimestamp, testSecret);
      const result = service.verifySignature(signature, testPayload);
      expect(result).toBe(false);
    });

    it('should return true for valid signature', () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = generateValidSignature(testPayload, timestamp, testSecret);
      const result = service.verifySignature(signature, testPayload);
      expect(result).toBe(true);
    });

    it('should return false for tampered payload', () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = generateValidSignature(testPayload, timestamp, testSecret);
      const tamperedPayload = JSON.stringify({ user_id: 'did:privy:attacker', email: 'attacker@evil.com' });
      const result = service.verifySignature(signature, tamperedPayload);
      expect(result).toBe(false);
    });

    it('should return false for wrong secret', () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = generateValidSignature(testPayload, timestamp, 'wrong-secret');
      const result = service.verifySignature(signature, testPayload);
      expect(result).toBe(false);
    });

    it('should handle Buffer payload', () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = generateValidSignature(testPayload, timestamp, testSecret);
      const bufferPayload = Buffer.from(testPayload, 'utf8');
      const result = service.verifySignature(signature, bufferPayload);
      expect(result).toBe(true);
    });

    it('should return false if signature length mismatch', () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = `t=${timestamp},v1=abc`; // Too short
      const result = service.verifySignature(signature, testPayload);
      expect(result).toBe(false);
    });

    it('should accept webhook within custom maxAge', () => {
      const customMaxAge = 600; // 10 minutes
      const serviceWithCustomAge = new PrivyWebhookService(testSecret, customMaxAge);
      const timestamp = Math.floor(Date.now() / 1000) - 500; // 8 minutes ago
      const signature = generateValidSignature(testPayload, timestamp, testSecret);
      const result = serviceWithCustomAge.verifySignature(signature, testPayload);
      expect(result).toBe(true);
    });

    it('should reject webhook outside custom maxAge', () => {
      const customMaxAge = 120; // 2 minutes
      const serviceWithCustomAge = new PrivyWebhookService(testSecret, customMaxAge);
      const timestamp = Math.floor(Date.now() / 1000) - 180; // 3 minutes ago
      const signature = generateValidSignature(testPayload, timestamp, testSecret);
      const result = serviceWithCustomAge.verifySignature(signature, testPayload);
      expect(result).toBe(false);
    });
  });

  describe('parsePayload', () => {
    let service: PrivyWebhookService;

    beforeEach(() => {
      service = new PrivyWebhookService(testSecret);
    });

    it('should parse valid JSON string', () => {
      const payload = service.parsePayload(testPayload);
      expect(payload).toEqual({ user_id: 'did:privy:test123', email: 'test@example.com' });
    });

    it('should parse valid JSON buffer', () => {
      const buffer = Buffer.from(testPayload, 'utf8');
      const payload = service.parsePayload(buffer);
      expect(payload).toEqual({ user_id: 'did:privy:test123', email: 'test@example.com' });
    });

    it('should return null for invalid JSON', () => {
      const payload = service.parsePayload('{ invalid json }');
      expect(payload).toBeNull();
    });

    it('should return null for empty string', () => {
      const payload = service.parsePayload('');
      expect(payload).toBeNull();
    });
  });

  describe('getPrivyWebhookService', () => {
    const originalEnv = process.env.PRIVY_WEBHOOK_SECRET;

    afterEach(() => {
      if (originalEnv) {
        process.env.PRIVY_WEBHOOK_SECRET = originalEnv;
      } else {
        delete process.env.PRIVY_WEBHOOK_SECRET;
      }
    });

    it('should return null if PRIVY_WEBHOOK_SECRET is not set', () => {
      delete process.env.PRIVY_WEBHOOK_SECRET;
      // Need to re-import to get updated env
      jest.isolateModules(() => {
        const { getPrivyWebhookService } = require('../PrivyWebhookService');
        expect(getPrivyWebhookService()).toBeNull();
      });
    });

    it('should return null if PRIVY_WEBHOOK_SECRET is empty', () => {
      process.env.PRIVY_WEBHOOK_SECRET = '';
      jest.isolateModules(() => {
        const { getPrivyWebhookService } = require('../PrivyWebhookService');
        expect(getPrivyWebhookService()).toBeNull();
      });
    });

    it('should return service if PRIVY_WEBHOOK_SECRET is set', () => {
      process.env.PRIVY_WEBHOOK_SECRET = 'test-secret';
      jest.isolateModules(() => {
        const { getPrivyWebhookService } = require('../PrivyWebhookService');
        const service = getPrivyWebhookService();
        expect(service).toBeInstanceOf(PrivyWebhookService);
      });
    });
  });
});
