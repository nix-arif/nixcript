"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { brandName } from "@/branding/brandname";
import * as z from "zod";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import authLogo from "@/branding/authlogo.svg";
import Image from "next/image";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { Spinner } from "@/components/ui/spinner";
import { useState } from "react";
import { CheckCircleIcon } from "lucide-react";

const formSchema = z.object({
  email: z.email("Please enter a valid email"),
});

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    const { error } = await authClient.requestPasswordReset({
      email: values.email,
      redirectTo: "/auth/reset-password",
    });

    if (error) {
      toast.error(error.message ?? "Failed to send reset email");
      return;
    }

    setSent(true);
  };

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted p-6 md:p-10">
      <div className="w-full max-w-sm md:max-w-4xl">
        <div className={cn("flex flex-col gap-6")}>
          <Card className="overflow-hidden p-0">
            <CardContent className="grid p-0 md:grid-cols-2">
              <div className="p-6 md:p-8">
                {sent ? (
                  <div className="flex flex-col items-center justify-center h-full gap-4 text-center py-8">
                    <CheckCircleIcon className="w-12 h-12 text-green-500" />
                    <h1 className="text-2xl font-bold">Check your email</h1>
                    <p className="text-muted-foreground text-sm">
                      If an account exists for that email, we&apos;ve sent a
                      password reset link. It may take a few minutes to arrive.
                    </p>
                    <Link
                      href="/auth/login"
                      className="text-sm underline-offset-2 hover:underline"
                    >
                      Back to login
                    </Link>
                  </div>
                ) : (
                  <form onSubmit={form.handleSubmit(onSubmit)}>
                    <FieldGroup>
                      <div className="flex flex-col items-center gap-2 text-center">
                        <h1 className="text-2xl font-bold">Forgot password?</h1>
                        <p className="text-balance text-muted-foreground">
                          Enter your email and we&apos;ll send you a reset link
                        </p>
                      </div>

                      <Controller
                        name="email"
                        control={form.control}
                        render={({ field, fieldState }) => (
                          <Field data-invalid={fieldState.invalid}>
                            <FieldLabel htmlFor="email">Email</FieldLabel>
                            <Input
                              id="email"
                              type="email"
                              placeholder="m@example.com"
                              autoFocus
                              {...field}
                            />
                            {fieldState.invalid && (
                              <FieldError errors={[fieldState.error]} />
                            )}
                          </Field>
                        )}
                      />

                      <Field>
                        <Button
                          type="submit"
                          disabled={form.formState.isSubmitting}
                        >
                          {form.formState.isSubmitting ? (
                            <>
                              <Spinner className="size-6" />
                              Sending…
                            </>
                          ) : (
                            "Send reset link"
                          )}
                        </Button>
                      </Field>

                      <FieldDescription className="text-center">
                        Remember your password?{" "}
                        <Link href="/auth/login">Back to login</Link>
                      </FieldDescription>
                    </FieldGroup>
                  </form>
                )}
              </div>
              <div className="relative hidden bg-muted md:block">
                <Image
                  src={authLogo}
                  alt="Image"
                  fill
                  className="object-cover dark:brightness-[0.2] dark:grayscale"
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
