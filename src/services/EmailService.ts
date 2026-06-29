import axios from "axios";
import { randomBytes } from "crypto";

export class EmailService {
  private readonly apiKey: string;
  private readonly fromEmail: string;

  constructor() {
    this.apiKey = process.env.EMAIL_API_KEY || "";
    this.fromEmail = process.env.EMAIL_FROM || "noreply@audioblocks.com";
  }

  async sendEmail(to: string, subject: string, html: string): Promise<void> {
    if (!this.apiKey) {
      console.log(`[EmailService] Skipping email send (no API key). To: ${to}, Subject: ${subject}`);
      return;
    }

    const provider = process.env.EMAIL_PROVIDER || "resend";

    if (provider === "resend") {
      await axios.post(
        "https://api.resend.com/v1/emails",
        {
          from: this.fromEmail,
          to,
          subject,
          html,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );
    } else if (provider === "sendgrid") {
      await axios.post(
        "https://api.sendgrid.com/v3/mail/send",
        {
          from: { email: this.fromEmail },
          personalizations: [{ to: [{ email: to }] }],
          subject,
          content: [{ type: "text/html", value: html }],
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );
    }
  }

  generateVerificationToken(): string {
    return randomBytes(32).toString("hex");
  }

  generateResetToken(): string {
    return randomBytes(32).toString("hex");
  }
}