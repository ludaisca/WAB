"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Rocket } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody } from "@/app/components/ui/card";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { PasswordInput } from "@/app/components/ui/password-input";
import { PasswordStrength } from "@/app/components/ui/password-strength";
import { FormField } from "@/app/components/ui/form-field";
import { Banner } from "@/app/components/ui/banner";
import { Logo } from "@/app/components/ui/logo";
import { onboardingSchema } from "@/lib/validations";

export function OnboardingForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError("");
    setErrors({});

    const parsed = onboardingSchema.safeParse({ name, email, password, businessName });
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      parsed.error.issues.forEach((i) => {
        fieldErrors[i.path[0] as string] = i.message;
      });
      setErrors(fieldErrors);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, businessName }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Error al configurar el sistema");
      }

      const result = await signIn("credentials", { email, password, redirect: false });
      if (result?.error) {
        router.push("/login?onboarded=1");
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Error al configurar el sistema");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-center">
        <Logo href="/" brand="WAB" size="lg" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuración inicial</CardTitle>
          <p className="text-sm text-muted-darker mt-1">
            Bienvenido. Crea la cuenta de administrador para empezar a usar el sistema.
          </p>
        </CardHeader>
        <CardBody>
          {serverError && (
            <Banner tone="danger" className="mb-4">
              {serverError}
            </Banner>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <FormField label="Nombre del negocio" required error={errors.businessName}>
              {(id) => (
                <Input
                  id={id}
                  type="text"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="Mi Empresa"
                  autoComplete="organization"
                  error={errors.businessName}
                />
              )}
            </FormField>

            <FormField label="Tu nombre" required error={errors.name}>
              {(id) => (
                <Input
                  id={id}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Tu nombre completo"
                  autoComplete="name"
                  error={errors.name}
                />
              )}
            </FormField>

            <FormField label="Email" required error={errors.email}>
              {(id) => (
                <Input
                  id={id}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@email.com"
                  autoComplete="email"
                  error={errors.email}
                />
              )}
            </FormField>

            <FormField label="Contraseña" required error={errors.password} hint="Mínimo 8 caracteres">
              {(id) => (
                <>
                  <PasswordInput
                    id={id}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Crea una contraseña segura"
                    autoComplete="new-password"
                    error={errors.password}
                  />
                  <PasswordStrength password={password} />
                </>
              )}
            </FormField>

            <Button type="submit" fullWidth loading={loading} icon={Rocket}>
              Crear cuenta y comenzar
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
