"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, X, Plus } from "lucide-react";
import { Card, CardBody, CardFooter } from "@/app/components/ui/card";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { FormField } from "@/app/components/ui/form-field";
import { DatePicker } from "@/app/components/ui/date-picker";
import { Spinner } from "@/app/components/ui/spinner";
import { useToast } from "@/app/components/ui/toast";

interface Account { id: string; name: string; channel: string; }
interface Template { id: string; name: string; language: string; category: string; status: string; }

export default function NewCampaignPage() {
  const router = useRouter();
  const { success, error: toastError } = useToast();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  const [name, setName] = useState("");
  const [waAccountId, setWaAccountId] = useState("");
  const [waTemplateId, setWaTemplateId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [sendNow, setSendNow] = useState(true);

  const [recipients, setRecipients] = useState<Array<{ phoneNumber: string; contactName: string }>>([
    { phoneNumber: "", contactName: "" },
  ]);
  const [csvText, setCsvText] = useState("");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/whatsapp/accounts").then(r => r.json()).then(d => {
      if (Array.isArray(d)) setAccounts(d.filter((a: Account) => a.channel === "META_CLOUD"));
    }).catch(() => toastError("Error al cargar cuentas"));
  }, [toastError]);

  useEffect(() => {
    if (!waAccountId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load templates when account selection changes
    setLoadingTemplates(true);
    fetch(`/api/whatsapp/templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ waAccountId }),
    })
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setTemplates(d); })
      .catch(() => toastError("Error al cargar plantillas"))
      .finally(() => setLoadingTemplates(false));
  }, [waAccountId, toastError]);

  function addRecipient() {
    setRecipients(prev => [...prev, { phoneNumber: "", contactName: "" }]);
  }
  function removeRecipient(idx: number) {
    setRecipients(prev => prev.filter((_, i) => i !== idx));
  }
  function updateRecipient(idx: number, field: "phoneNumber" | "contactName", value: string) {
    setRecipients(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  }
  function handleCsvImport() {
    if (!csvText.trim()) return;
    const lines = csvText.trim().split("\n");
    const newRecipients = lines.map(line => {
      const [phone, name] = line.split(",").map(s => s.trim());
      return { phoneNumber: phone || "", contactName: name || "" };
    }).filter(r => r.phoneNumber);
    setRecipients(prev => [...prev, ...newRecipients].filter(Boolean));
    setCsvText("");
    success(`${newRecipients.length} destinatarios agregados`);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = "Requerido";
    if (!waAccountId) newErrors.waAccountId = "Selecciona una cuenta";
    if (!waTemplateId) newErrors.waTemplateId = "Selecciona una plantilla";
    const validRecipients = recipients.filter(r => r.phoneNumber.trim());
    if (validRecipients.length === 0) newErrors.recipients = "Al menos un destinatario";
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    setSaving(true);
    try {
      const res = await fetch("/api/whatsapp/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          waAccountId,
          waTemplateId,
          scheduledAt: sendNow ? null : scheduledAt || null,
          recipients: validRecipients.map(r => ({
            phoneNumber: r.phoneNumber.trim(),
            contactName: r.contactName.trim() || undefined,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");

      if (sendNow) {
        await fetch(`/api/whatsapp/campaigns/${data.id}/send`, { method: "POST" });
      }

      success(sendNow ? "Campaña iniciada" : "Campaña programada");
      router.push("/whatsapp/campanas");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <Link href="/whatsapp/campanas" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors mb-3">
        <ArrowLeft size={14} /> Volver a campañas
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">Nueva campaña</h1>

      <Card>
        <form onSubmit={handleSubmit}>
          <CardBody>
            <div className="space-y-5">
              <FormField label="Nombre de la campaña" required error={errors.name}>
                {(id) => <Input id={id} value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Promoción Julio 2026" error={errors.name} />}
              </FormField>

              <div className="grid gap-5 sm:grid-cols-2">
                <FormField label="Cuenta WhatsApp" required error={errors.waAccountId}>
                  {(id) => (
                    <Select id={id} value={waAccountId} onChange={e => { setWaAccountId(e.target.value); setWaTemplateId(""); }} placeholder="Seleccionar" error={errors.waAccountId}>
                      {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </Select>
                  )}
                </FormField>
                <FormField label="Plantilla" required error={errors.waTemplateId}>
                  {(id) => (
                    <Select id={id} value={waTemplateId} onChange={e => setWaTemplateId(e.target.value)} placeholder={loadingTemplates ? "Cargando..." : "Seleccionar"} error={errors.waTemplateId} disabled={!waAccountId || loadingTemplates}>
                      {templates.filter(t => t.status === "APPROVED").map(t => (
                        <option key={t.id} value={t.id}>{t.name} ({t.language})</option>
                      ))}
                    </Select>
                  )}
                </FormField>
              </div>

              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium">Enviar ahora</p>
                  <p className="text-xs text-muted-darker">La campaña comenzará a enviarse inmediatamente</p>
                </div>
                <input type="checkbox" checked={sendNow} onChange={e => setSendNow(e.target.checked)} className="h-5 w-5 rounded border-border text-accent focus:ring-accent" />
              </div>

              {!sendNow && (
                <FormField label="Programar para" hint="Fecha y hora de inicio">
                  {(id) => <DatePicker id={id} value={scheduledAt} onChange={setScheduledAt} placeholder="Seleccionar fecha" />}
                </FormField>
              )}

              <div className="border-t border-border pt-4">
                <h3 className="text-sm font-semibold mb-3">Destinatarios ({recipients.filter(r => r.phoneNumber.trim()).length})</h3>

                <div className="space-y-2 mb-4">
                  {recipients.map((r, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        value={r.phoneNumber}
                        onChange={e => updateRecipient(i, "phoneNumber", e.target.value)}
                        placeholder="5215551234567"
                        className="flex-1"
                      />
                      <Input
                        value={r.contactName}
                        onChange={e => updateRecipient(i, "contactName", e.target.value)}
                        placeholder="Nombre (opcional)"
                        className="w-36"
                      />
                      {recipients.length > 1 && (
                        <Button variant="ghost" size="sm" icon={X} onClick={() => removeRecipient(i)} />
                      )}
                    </div>
                  ))}
                  <Button type="button" variant="secondary" size="sm" icon={Plus} onClick={addRecipient}>
                    Agregar número
                  </Button>
                </div>

                <details className="mt-4">
                  <summary className="text-sm text-muted-darker cursor-pointer hover:text-foreground">Importar desde CSV</summary>
                  <div className="mt-2 space-y-2">
                    <textarea
                      value={csvText}
                      onChange={e => setCsvText(e.target.value)}
                      placeholder="5215551234567, Juan Pérez&#10;5215557654321, María García"
                      rows={4}
                      className="w-full rounded-lg border border-border bg-surface-light px-3 py-2 text-sm placeholder:text-muted-darker focus:outline-none focus:ring-2 focus:ring-accent/40"
                    />
                    <Button type="button" variant="secondary" size="sm" onClick={handleCsvImport} disabled={!csvText.trim()}>
                      Importar
                    </Button>
                  </div>
                </details>
                {errors.recipients && <p className="text-xs text-danger mt-1">{errors.recipients}</p>}
              </div>
            </div>
          </CardBody>
          <CardFooter>
            <Button type="submit" icon={saving ? undefined : Save} disabled={saving}>
              {saving ? <Spinner /> : sendNow ? "Crear y enviar" : "Programar campaña"}
            </Button>
            <Link href="/whatsapp/campanas">
              <Button type="button" variant="secondary">Cancelar</Button>
            </Link>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
