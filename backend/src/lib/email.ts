/**
 * AWS SES (v2) email helper for transactional sends.
 *
 * Required env vars:
 *   SES_FROM_ADDRESS — verified SES sender address. If unset, sends are
 *                      logged and skipped (no-op) so local dev doesn't fail.
 *   AWS_REGION       — AWS region (default: "us-east-1").
 *
 * Credentials are resolved from the default AWS credential chain — the
 * Fargate task role on AWS, or `~/.aws/credentials` / env vars locally.
 */

import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

const client = new SESv2Client({
  region: process.env.AWS_REGION ?? "us-east-1",
});

const FROM = process.env.SES_FROM_ADDRESS;

export const emailEnabled = Boolean(FROM);

export async function sendEmail(params: {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string[];
}): Promise<void> {
  if (!FROM) {
    console.warn("[email] SES_FROM_ADDRESS not set; skipping send");
    return;
  }
  const toAddresses = Array.isArray(params.to) ? params.to : [params.to];
  await client.send(
    new SendEmailCommand({
      FromEmailAddress: FROM,
      Destination: { ToAddresses: toAddresses },
      ReplyToAddresses: params.replyTo,
      Content: {
        Simple: {
          Subject: { Data: params.subject, Charset: "UTF-8" },
          Body: {
            Html: { Data: params.html, Charset: "UTF-8" },
            Text: params.text
              ? { Data: params.text, Charset: "UTF-8" }
              : undefined,
          },
        },
      },
    }),
  );
}
