import React, { useState } from "react";
import { useAuth } from "./useAuth";
import { Button } from "@mike/shared/ui/button";
import { Input } from "@mike/shared/ui/input";
import { Label } from "@mike/shared/ui/label";
import { Spinner } from "@mike/shared/ui/spinner";
import { MikeIcon } from "@mike/shared/chat/mike-icon";

export function LoginPage(): React.ReactElement {
  const { login, loading, error } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    await login(email.trim(), password);
  };

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-background px-5 py-8 @sm:px-6">
      <form
        className="flex w-full max-w-[320px] flex-col gap-5"
        onSubmit={handleSubmit}
        noValidate
      >
        <div className="flex flex-col items-center gap-2.5 text-center">
          <MikeIcon size={44} />
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              Welcome to Mike
            </h1>
            <p className="text-sm text-muted-foreground">
              AI-powered legal assistant
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email address</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@firm.com"
              disabled={loading}
              autoComplete="email"
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={loading}
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <p
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {error}
            </p>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={loading || !email.trim() || !password}
          >
            {loading ? <Spinner label="Signing in…" /> : "Sign in"}
          </Button>
        </div>
      </form>
    </div>
  );
}
