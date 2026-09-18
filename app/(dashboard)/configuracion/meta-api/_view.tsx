"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FlaskConical, Save } from "lucide-react";
import { Card, CardBody, CardFooter, CardTitle } from "@/app/components/ui/card";
import { Button } from "@/app/components/ui/button";
import { Badge } from "@/app/components/ui/badge";
import { Banner } from "@/app/components/ui/banner";
import { Select } from "@/app/components/ui/select";
import { FormField } from "@/app/components/ui/form-field";
import { PageHeader } from "@/app/components/ui/page-header";
import { SkeletonDetail } from "@/app/components/ui/skeleton";
import { useToast } from "@/app/components/ui/toast";
import { formatDateTime } from "@/lib/timezone";
import type { GraphApiVersionInfo } from "@/lib/whatsapp/graph-api-versions";

interface MetaApiState {
  effective: string;
  override: string | null;
  default: string;
  updatedAt: string | null;
  updatedBy: string | null;
  versions: GraphApiVersionInfo[];
}

interface AccountOption {
  id: string;
  name: string;
  phoneNumberId: string | null;
}

interface CheckResult {
  name: string;
  ok: boolean;
  status: number | null;
  code: number | null;
  message: string | null;
  ms: number;
}

interface TestResult {
  version: string;
  account: string;
  ok: boolean;
  checks: CheckResult[];
}

// "" = seguir el default del código.
const DEFAULT_VALUE = "";

function formatDay(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function daysUntil(iso: string): number {
  return Math.round((new Date(`${iso}T12:00:00Z`).getTime() - Date.now()) / 86_400_000);
}

export function MetaApiView() {
  const { success, error: toastError } = useToast();
  const [state, setState] = useState<MetaApiState | null>(null);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(DEFAULT_VALUE);
  const [accountId, setAccountId] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/configuracion/meta-api").then((r) => r.json()),
      fetch("/api/whatsapp/accounts").then((r) => r.json()),
    ])
      .then(([s, a]) => {
        if (s.error) throw new Error(s.error);
        setState(s as MetaApiState);
        setSelected((s as MetaApiState).override ?? DEFAULT_VALUE);
        const list = (Array.isArray(a) ? a : []).filter((x: AccountOption) => x.phoneNumberId);
        setAccounts(list);
        setAccountId(list[0]?.id ?? "");
      })
      .catch((err) => toastError(err instanceof Error ? err.message : "Error al cargar la configuración"))
      .finally(() => setLoading(false));
  }, [toastError]);

  if (loading || !state) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <SkeletonDetail />
      </div>
    );
  }

  // Versión que quedaría en uso con lo elegido en el selector.
  const pickedVersion = selected || state.default;
  const pickedInfo = state.versions.find((v) => v.version === pickedVersion);
  const expiresInDays = pickedInfo?.expires ? daysUntil(pickedInfo.expires) : null;
  const dirty = selected !== (state.override ?? DEFAULT_VALUE);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/configuracion/meta-api", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: selected || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo guardar");
      setState(data as MetaApiState);
      success(`Versión de la API de Meta: ${(data as MetaApiState).effective}. Se aplica en menos de 30 segundos.`);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/configuracion/meta-api/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: pickedVersion, accountId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo probar");
      setTestResult(data as TestResult);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "No se pudo probar");
    } finally {
      setTesting(false);
    }
  }

  const usingOverride = state.override !== null;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Link
        href="/configuracion"
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors"
      >
        <ArrowLeft size={14} /> Configuración
      </Link>

      <PageHeader
        title="API de Meta"
        description="Versión del Graph API que usa el sistema para enviar mensajes, descargar media y gestionar plantillas."
      />

      <Card>
        <CardBody className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>Versión en uso</CardTitle>
            <Badge tone="accent">
              <span className="font-mono">{state.effective}</span>
            </Badge>
            <Badge tone={usingOverride ? "warning" : "neutral"} size="sm">
              {usingOverride ? "Forzada por un admin" : "Predeterminada del sistema"}
            </Badge>
          </div>
          {state.updatedAt && (
            <p className="text-xs text-muted-darker">
              Último cambio: {formatDateTime(state.updatedAt, { dateStyle: "medium", timeStyle: "short" })}
              {state.updatedBy ? ` · ${state.updatedBy}` : ""}
            </p>
          )}

          <FormField
            label="Versión del Graph API"
            hint="Un cambio se aplica a todos los envíos en menos de 30 segundos, sin reiniciar. Vuelve a “Predeterminada” para seguir la versión que trae el código."
          >
            {(id, describedBy) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setTestResult(null);
                }}
              >
                <option value={DEFAULT_VALUE}>Predeterminada del sistema ({state.default})</option>
                {state.versions.map((v) => (
                  <option key={v.version} value={v.version}>
                    {v.version}
                    {v.expires ? ` — expira ${formatDay(v.expires)}` : " — más reciente"}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          {expiresInDays !== null && expiresInDays <= 180 && (
            <Banner tone="warning" title={`${pickedVersion} expira en ${expiresInDays} días`}>
              Meta redirige las versiones vencidas a la más antigua disponible, con posibles cambios de comportamiento.
              Úsala solo como respaldo temporal.
            </Banner>
          )}

          <Banner tone="info">
            Esto solo afecta las llamadas <strong>salientes</strong> a Meta. La versión de los webhooks entrantes
            se define en la configuración de la app dentro de Meta.
          </Banner>
        </CardBody>
        <CardFooter>
          <Button icon={Save} onClick={save} loading={saving} disabled={!dirty}>
            Guardar
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardBody className="space-y-4">
          <CardTitle>Probar antes de guardar</CardTitle>
          <p className="text-sm text-muted-darker">
            Hace dos consultas de <strong>solo lectura</strong> a Meta con la versión elegida arriba (
            <span className="font-mono">{pickedVersion}</span>): datos del número y listado de plantillas. No envía
            mensajes ni modifica nada.
          </p>

          {accounts.length === 0 ? (
            <Banner tone="neutral">No hay cuentas de WhatsApp con phone number ID configurado para probar.</Banner>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-end gap-3">
              <FormField label="Cuenta de prueba" className="flex-1">
                {(id) => (
                  <Select id={id} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
              <Button variant="secondary" icon={FlaskConical} onClick={test} loading={testing} disabled={!accountId}>
                Probar {pickedVersion}
              </Button>
            </div>
          )}

          {testResult && (
            <div className="space-y-2" role="status">
              <Banner
                tone={testResult.ok ? "success" : "danger"}
                title={
                  testResult.ok
                    ? `${testResult.version} responde correctamente`
                    : `${testResult.version} falló alguna consulta`
                }
              >
                Cuenta: {testResult.account}
              </Banner>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {testResult.checks.map((c) => (
                  <li key={c.name} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="text-foreground">{c.name}</p>
                      {c.message && <p className="text-xs text-danger break-words">{c.message}</p>}
                      {c.code === 190 && (
                        <p className="text-xs text-muted-darker">
                          Meta aceptó la versión, pero rechazó el token de la cuenta (inválido o vencido).
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono text-xs text-muted-darker">{c.ms} ms</span>
                      <Badge tone={c.ok ? "success" : "danger"} size="sm">
                        {c.ok ? "OK" : `Error${c.status ? ` ${c.status}` : ""}`}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
