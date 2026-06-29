import React, { useState } from "react";
import {
  Button,
  Field,
  Input,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useAuth } from "./useAuth";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    padding: tokens.spacingHorizontalL,
    maxWidth: "340px",
    margin: "0 auto",
    height: "100vh",
    justifyContent: "center",
  },
  header: {
    textAlign: "center",
    marginBottom: tokens.spacingVerticalM,
  },
  title: {
    fontSize: tokens.fontSizeBase600,
    fontWeight: tokens.fontWeightSemibold,
    display: "block",
  },
  subtitle: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    display: "block",
    marginTop: tokens.spacingVerticalXS,
  },
  error: {
    color: tokens.colorStatusDangerForeground1,
    fontSize: tokens.fontSizeBase200,
    padding: `${tokens.spacingVerticalXS} 0`,
  },
  submitButton: {
    width: "100%",
    marginTop: tokens.spacingVerticalS,
  },
  spinnerRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
  },
});

export function LoginPage(): React.ReactElement {
  const styles = useStyles();
  const { login, loading, error } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    await login(email.trim(), password);
  };

  return (
    <form className={styles.root} onSubmit={handleSubmit} noValidate>
      <div className={styles.header}>
        <Text className={styles.title}>Mike</Text>
        <Text className={styles.subtitle}>AI-powered legal assistant</Text>
      </div>

      <Field label="Email address" required>
        <Input
          type="email"
          value={email}
          onChange={(_, d) => setEmail(d.value)}
          placeholder="you@firm.com"
          disabled={loading}
          autoComplete="email"
        />
      </Field>

      <Field label="Password" required>
        <Input
          type="password"
          value={password}
          onChange={(_, d) => setPassword(d.value)}
          placeholder="••••••••"
          disabled={loading}
          autoComplete="current-password"
        />
      </Field>

      {error && (
        <Text className={styles.error} role="alert">
          {error}
        </Text>
      )}

      <Button
        type="submit"
        appearance="primary"
        className={styles.submitButton}
        disabled={loading || !email.trim() || !password}
      >
        {loading ? (
          <span className={styles.spinnerRow}>
            <Spinner size="tiny" />
            Signing in…
          </span>
        ) : (
          "Sign in"
        )}
      </Button>
    </form>
  );
}
