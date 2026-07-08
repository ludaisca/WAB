"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { Upload, FileText, X, ArrowLeft, Database } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody } from "@/app/components/ui/card";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { FormField } from "@/app/components/ui/form-field";
import { Spinner } from "@/app/components/ui/spinner";
import { Badge } from "@/app/components/ui/badge";
import { useToast } from "@/app/components/ui/toast";

interface Bot {
  id: string;
  name: string;
  waAccount: { name: string };
}

interface Doc {
  id: string;
  title: string;
  chunkIndex: number;
  sourceName: string | null;
  createdAt: string;
  bots: string[];
}

export default function ConocimientoPage() {
  const { success, error: toastError } = useToast();
  const [bots, setBots] = useState<Bot[]>([]);
  const [allDocs, setAllDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [docTitle, setDocTitle] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedBotId, setSelectedBotId] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchData = useCallback(async () => {
    try {
      const [botsRes] = await Promise.all([
        fetch("/api/whatsapp/bots"),
      ]);
      const botsData = await botsRes.json();
      if (Array.isArray(botsData)) setBots(botsData);

      const docs: Doc[] = [];
      for (const bot of Array.isArray(botsData) ? botsData : []) {
        try {
          const kRes = await fetch(`/api/whatsapp/bots/${bot.id}/knowledge`);
          const kData = await kRes.json();
          if (Array.isArray(kData)) {
            for (const d of kData) {
              const existing = docs.find((x) => x.id === d.id);
              if (existing) {
                if (!existing.bots.includes(bot.name)) existing.bots.push(bot.name);
              } else {
                docs.push({ ...d, bots: [bot.name] });
              }
            }
          }
        } catch {}
      }
      setAllDocs(docs);
    } catch {
      toastError("Error al cargar");
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleUpload() {
    if (!selectedFile || !selectedBotId) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("title", docTitle || selectedFile.name);
      formData.append("botIds", selectedBotId);

      const res = await fetch(`/api/whatsapp/bots/${selectedBotId}/knowledge/upload`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      success("Documento indexado");
      setSelectedFile(null);
      setDocTitle("");
      if (fileRef.current) fileRef.current.value = "";
      fetchData();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al subir");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(docId: string, botId: string) {
    try {
      await fetch(`/api/whatsapp/bots/${botId}/knowledge/${docId}`, { method: "DELETE" });
      success("Documento eliminado");
      fetchData();
    } catch {
      toastError("Error al eliminar");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Base de Conocimiento</h1>
        <p className="mt-1 text-sm text-muted">
          Sube documentos para que los bots con RAG activado puedan buscar información antes de responder.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle>Subir documento</CardTitle></CardHeader>
        <CardBody>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Título">
                {(id) => <Input id={id} value={docTitle} onChange={(e) => setDocTitle(e.target.value)} placeholder="Ej: Manual de soporte" />}
              </FormField>
              <FormField label="Bot destino" required>
                {(id) => (
                  <select
                    id={id}
                    value={selectedBotId}
                    onChange={(e) => setSelectedBotId(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface-light px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40"
                  >
                    <option value="">Seleccionar bot...</option>
                    {bots.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.waAccount?.name})
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
            </div>
            <FormField label="Archivo" hint=".txt, .md, .csv, .json (máx 10MB)">
              {(id) => (
                <input
                  ref={fileRef}
                  type="file"
                  accept=".txt,.md,.csv,.json"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-foreground file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-surface-light file:text-foreground hover:file:bg-surface file:cursor-pointer"
                />
              )}
            </FormField>
            <Button icon={Upload} onClick={handleUpload} disabled={uploading || !selectedFile || !selectedBotId}>
              {uploading ? <Spinner /> : "Subir e indexar"}
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Documentos indexados ({allDocs.length})</CardTitle></CardHeader>
        <CardBody>
          {loading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : allDocs.length === 0 ? (
            <div className="text-center py-8">
              <Database size={32} className="mx-auto text-muted-darker mb-2" />
              <p className="text-sm text-muted">Sin documentos. Sube archivos para empezar.</p>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-border">
                    <th className="px-5 py-2.5 text-left text-xs font-medium text-muted-darker uppercase">Documento</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-darker uppercase">Chunk</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-darker uppercase">Bots</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-darker uppercase">Fecha</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-darker uppercase w-12" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {allDocs.map((doc) => {
                    const firstBotId = bots.find((b) => doc.bots.includes(b.name))?.id;
                    return (
                      <tr key={`${doc.id}-${doc.chunkIndex}`} className="hover:bg-surface-light/40">
                        <td className="px-5 py-3 font-medium text-sm">
                          {doc.title}
                          {doc.sourceName && <span className="text-xs text-muted-darker ml-2">{doc.sourceName}</span>}
                        </td>
                        <td className="px-4 py-3 text-xs font-mono">{doc.chunkIndex}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {doc.bots.map((b) => (
                              <Badge key={b} tone="neutral" size="sm">{b}</Badge>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-darker">
                          {new Date(doc.createdAt).toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {firstBotId && (
                            <Button variant="ghost" size="sm" icon={X} onClick={() => handleDelete(doc.id, firstBotId)} />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
