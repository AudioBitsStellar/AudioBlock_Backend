import axios from 'axios';
import { randomBytes } from 'crypto';

/**
 * Email sending service supporting Resend and SendGrid providers.
 * Falls back to console logging when no API key is configured (development).
 */
export class EmailService {
  private readonly apiKey: string;
  private readonly fromEmail: string;

  constructor() {
    this.apiKey = process.env.EMAIL_API_KEY || '';
    this.fromEmail = process.env.EMAIL_FROM || 'noreply@audioblocks.com';
  }

  /**
   * Send an HTML email to the specified recipient.
   * Skips sending and logs to console if no API key is configured.
   *
   * @param to - Recipient email address.
   * @param subject - Email subject line.
   * @param html - HTML body content.
   */
  async sendEmail(to: string, subject: string, html: string): Promise<void> {
    if (!this.apiKey) {
      console.log(
        `[EmailService] Skipping email send (no API key). To: ${to}, Subject: ${subject}`,
      );
      return;
    }

    const provider = process.env.EMAIL_PROVIDER || 'resend';

    if (provider === 'resend') {
      await axios.post(
        'https://api.resend.com/v1/emails',
        {
          from: this.fromEmail,
          to,
          subject,
          html,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        },
      );
    } else if (provider === 'sendgrid') {
      await axios.post(
        'https://api.sendgrid.com/v3/mail/send',
        {
          from: { email: this.fromEmail },
          personalizations: [{ to: [{ email: to }] }],
          subject,
          content: [{ type: 'text/html', value: html }],
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        },
      );
    }
  }

  /**
   * Generate a cryptographically secure hex token for email verification.
   *
   * @returns 64-character hex string.
   */
  generateVerificationToken(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Generate a cryptographically secure hex token for password reset.
   *
   * @returns 64-character hex string.
   */
  generateResetToken(): string {
    return randomBytes(32).toString('hex');
  }
}
