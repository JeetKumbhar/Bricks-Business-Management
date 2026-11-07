import { useState } from "react";
import { useForm } from "react-hook-form";
import { useLocation } from "react-router-dom";
import { AlertCircle, Info, Mail } from "lucide-react";
import wordmark from "../assets/aayush-wordmark.png";
import { Button, Card, CardBody, Input } from "../components/ui";
import PasswordInput from "../features/auth/PasswordInput";
import useAuth from "../features/auth/useAuth";
import { ApiError, getErrorMessage, getFieldErrors } from "../services/api";
import { loginResolver } from "../validators/loginValidator";

/**
 * Sign in with the owner account created by `npm run create-owner` on the server.
 * On success AuthContext holds the user and the public-only route sends the owner to the page they asked for (or the
 * Dashboard), so this page does not navigate by itself.
 */
export default function Login() {
  const { login } = useAuth();
  const location = useLocation();
  const [formError, setFormError] = useState("");

  const {
    register,
    handleSubmit,
    setError,
    resetField,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: loginResolver, defaultValues: { email: "", password: "" } });

  const onSubmit = async ({ email, password }) => {
    setFormError("");
    try {
      await login(email, password);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        // The server named the fields it did not accept.
        const fields = getFieldErrors(err);
        for (const [field, message] of Object.entries(fields)) {
          if (field === "email" || field === "password") setError(field, { type: "server", message });
        }
        if (Object.keys(fields).length === 0) setFormError(getErrorMessage(err));
        return;
      }
      if (err instanceof ApiError && err.status === 401) resetField("password");
      setFormError(getErrorMessage(err, "Could not sign in. Please try again."));
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <div className="rounded-xl bg-white px-4 py-3 shadow-card">
            <img src={wordmark} alt="Aayush Carting" className="block h-14 w-auto" />
          </div>
        </div>

        <Card>
          <CardBody>
            <h1 className="type-page-heading">Sign in</h1>
            <p className="mt-1 text-sm text-fg-muted">Use your Aayush Carting account to continue.</p>

            {location.state?.expired && !formError && (
              <p role="status" className="mt-4 flex items-start gap-2 rounded-lg bg-primary-soft px-3 py-2.5 text-sm text-fg">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                Your session has ended. Please sign in again.
              </p>
            )}

            {formError && (
              <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {formError}
              </p>
            )}

            <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-5 flex flex-col gap-4">
              <Input
                label="Email"
                type="email"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                leftIcon={Mail}
                placeholder="you@example.com"
                error={errors.email?.message}
                {...register("email")}
              />
              <PasswordInput label="Password" autoComplete="current-password" placeholder="Your password" error={errors.password?.message} {...register("password")} />
              <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
                {isSubmitting ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
