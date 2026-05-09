function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function configuredDomains(): string[] {
  return parseList(
    process.env.ALLOWED_EMAIL_DOMAINS ?? process.env.ALLOWED_EMAIL_DOMAIN,
  ).map((domain) => domain.replace(/^@/, ""));
}

function configuredEmails(): string[] {
  return parseList(process.env.ALLOWED_EMAILS);
}

export function isEmailAllowedForInstall(email: string | undefined): boolean {
  const domains = configuredDomains();
  const emails = configuredEmails();

  if (domains.length === 0 && emails.length === 0) {
    return true;
  }

  const normalized = (email ?? "").trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) {
    return false;
  }

  if (emails.includes(normalized)) {
    return true;
  }

  const domain = normalized.split("@").pop() ?? "";
  return domains.includes(domain);
}

export function installAccessDeniedMessage(): string {
  return "This Mike install is restricted to approved email addresses.";
}
