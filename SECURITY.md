# Security Policy

## Supported versions

There are no tagged releases yet; the only supported version is the tip of
`main`. If you are self-hosting, please update to the latest `main` before
reporting — the issue may already be fixed.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub:

**Security tab → Report a vulnerability** on this repository
(GitHub's private vulnerability reporting).

Please do not open a public issue for anything security-sensitive.

This project has a solo maintainer. You can expect an acknowledgment within
7 days; fixes are prioritized by severity after that.

## Scope

- Mike is **self-hosted** — there is no hosted service operated by this
  repository to test against. Reports about the code, default configuration,
  and deployment guidance in this repo are all in scope. Findings that only
  apply to a specific third-party deployment should go to whoever operates it.
- Mike is an **LLM legal product**, so LLM-specific reports are explicitly
  welcome: prompt injection (including via uploaded documents), getting the
  model to ignore its guardrails, leaking another user's data or system
  prompts through model output, and similar.
- Secrets accidentally committed to this repository's history are also worth
  a private report, even though CI runs a secret scanner.
