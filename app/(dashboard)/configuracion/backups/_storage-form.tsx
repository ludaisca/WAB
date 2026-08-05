"use client";

import { useState, useEffect } from "react";
import { Eye, EyeOff, Save, Wifi } from "lucide-react";
import { Card, CardBody, CardFooter } from "@/app/components/ui/card";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { FormField } from "@/app/components/ui/form-field";
import { Switch } from "@/app/components/ui/switch";
import { Spinner } from "@/app/components/ui/spinner";
import { SkeletonText } from "@/app/components/ui/skeleton";
import { SectionHeader } from "@/app/components/ui/section-header";
import { useToast } from "@/app/components/ui/toast";

interface StorageSettings {
  s3Enabled: boolean;
  s3Endpoint: string | null;
  s3Region: string | null;
  s3Bucket: string | null;
  s3AccessKeyId: string | null;
  s3SecretAccessKey: string | null;
  s3ForcePathStyle: boolean;
}

export function StorageSettingsForm() {
  const { success, error: toastError } = useToast();
  const [settings, setSettings] = useState<StorageSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const [enabled, setEnabled] = useState(false);
  const [endpoint, setEndpoint] = useState("");
  const [region, setRegion] = useState("auto");
  const [bucket, setBucket] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [forcePathStyle, setForcePathStyle] = useState(false);

  useEffect(() => {
    fetch("/api/configuracion/backups/storage")
      .then((r) => r.json())
      .then((d: StorageSettings) => {
        setSettings(d);
        setEnabled(!!d.s3Enabled);
        setEndpoint(d.s3Endpoint || "");
        setRegion(d.s3Region || "auto");
        setBucket(d.s3Bucket || "");
        setAccessKeyId(d.s3AccessKeyId || "");
        setForcePathStyle(!!d.s3ForcePathStyle);
      })
      .catch(() => toastError("Error al cargar la configuración de almacenamiento"))
      .finally(() => setLoading(false));
  }, [toastError]);

  function currentFormValues() {
    return {
      s3Endpoint: endpoint.trim(),
      s3Region: region.trim(),
      s3Bucket: bucket.trim(),
      s3AccessKeyId: accessKeyId.trim(),
      s3SecretAccessKey: secretAccessKey.trim(),
      s3ForcePathStyle: forcePathStyle,
    };
  }

  async function handleTest() {
    setTesting(true);
    try {
      const res = await fetch("/api/configuracion/backups/storage/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(currentFormValues()),
      });
      const data = await res.json();
      if (data.ok) success("Conexión exitosa");
      else toastError(data.error || "No se pudo conectar");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "No se pudo conectar");
    } finally {
      setTesting(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const body: Record<string, string | boolean> = {
        s3Enabled: enabled,
        ...currentFormValues(),
      };
      if (!secretAccessKey.trim()) delete body.s3SecretAccessKey;

      const res = await fetch("/api/configuracion/backups/storage", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setSettings(data);
      setSecretAccessKey("");
      setShowSecret(false);
      success("Configuración de almacenamiento guardada");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="space-y-4">
        <SectionHeader eyebrow="Durabilidad" title="Almacenamiento externo (S3/R2)" />
        <Card><CardBody><SkeletonText lines={4} /></CardBody></Card>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <SectionHeader eyebrow="Durabilidad" title="Almacenamiento externo (S3/R2)" />
      <p className="text-xs text-muted-darker -mt-2">
        Copia adicional de cada respaldo en un bucket S3 o Cloudflare R2, fuera del volumen de este contenedor.
        Los respaldos locales no cambian — esto es durabilidad extra, no un reemplazo.
      </p>

      <Card>
        <form onSubmit={handleSave}>
          <CardBody>
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Subir respaldos a S3/R2</p>
                  <p className="text-xs text-muted-darker">Cada respaldo completado se sube automáticamente al bucket configurado.</p>
                </div>
                <Switch checked={enabled} onCheckedChange={setEnabled} />
              </div>

              {enabled && (
                <>
                  <FormField label="Endpoint" hint="Vacío para AWS S3 real. Para R2: https://<account_id>.r2.cloudflarestorage.com">
                    {(id) => (
                      <Input
                        id={id}
                        value={endpoint}
                        onChange={(e) => setEndpoint(e.target.value)}
                        placeholder="https://<account_id>.r2.cloudflarestorage.com"
                      />
                    )}
                  </FormField>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <FormField label="Región" hint='R2 usa "auto"'>
                      {(id) => (
                        <Input id={id} value={region} onChange={(e) => setRegion(e.target.value)} placeholder="auto" />
                      )}
                    </FormField>
                    <FormField label="Bucket">
                      {(id) => (
                        <Input id={id} value={bucket} onChange={(e) => setBucket(e.target.value)} placeholder="wab-backups" />
                      )}
                    </FormField>
                  </div>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <FormField label="Access Key ID">
                      {(id) => (
                        <Input id={id} value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} placeholder="AKIA..." />
                      )}
                    </FormField>
                    <FormField label="Secret Access Key">
                      {(id) => (
                        <div className="relative">
                          <Input
                            id={id}
                            type={showSecret ? "text" : "password"}
                            value={secretAccessKey}
                            onChange={(e) => setSecretAccessKey(e.target.value)}
                            placeholder={settings?.s3SecretAccessKey ? "•••••••• (configurada)" : "..."}
                          />
                          <button
                            type="button"
                            onClick={() => setShowSecret(!showSecret)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-darker hover:text-foreground"
                          >
                            {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                      )}
                    </FormField>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Forzar path-style</p>
                      <p className="text-xs text-muted-darker">Normalmente necesario para R2/MinIO con endpoint propio.</p>
                    </div>
                    <Switch checked={forcePathStyle} onCheckedChange={setForcePathStyle} />
                  </div>
                </>
              )}
            </div>
          </CardBody>
          <CardFooter>
            <Button type="submit" icon={saving ? undefined : Save} disabled={saving}>
              {saving ? <Spinner /> : "Guardar"}
            </Button>
            {enabled && (
              <Button
                type="button"
                variant="secondary"
                icon={testing ? undefined : Wifi}
                onClick={handleTest}
                disabled={testing || !bucket.trim() || !accessKeyId.trim()}
              >
                {testing ? <Spinner /> : "Probar conexión"}
              </Button>
            )}
          </CardFooter>
        </form>
      </Card>
    </section>
  );
}
