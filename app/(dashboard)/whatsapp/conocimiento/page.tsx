"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Upload, Trash2, Database } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody } from "@/app/components/ui/card";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { FormField } from "@/app/components/ui/form-field";
import { Spinner } from "@/app/components/ui/spinner";
import { Badge } from "@/app/components/ui/badge";
import { PageHeader } from "@/app/components/ui/page-header";
import { Select } from "@/app/components/ui/select";
import { Table, type TableColumn } from "@/app/components/ui/table";
import { DropdownItem } from "@/app/components/ui/dropdown";
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
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [docTitle, setDocTitle] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedBotId, setSelectedBotId] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const botsRes = await fetch("/api/whatsapp/bots");
      const botsData = await botsRes.json();
      const botsList: Bot[] = Array.isArray(botsData) ? botsData : [];
      setBots(botsList);

      const knowledgeByBot = await Promise.all(
        botsList.map(async (bot) => {
          try {
            const kRes = await fetch(`/api/whatsapp/bots/${bot.id}/knowledge`);
            const kData = await kRes.json();
            return { bot, docs: Array.isArray(kData) ? (kData as Omit<Doc, "bots">[]) : [] };
          } catch {
            return { bot, docs: [] as Omit<Doc, "bots">[] };
          }
        })
      );

      const docs: Doc[] = [];
      for (const { bot, docs: kDocs } of knowledgeByBot) {
        for (const d of kDocs) {
          const existing = docs.find((x) => x.id === d.id);
          if (existing) {
            if (!existing.bots.includes(bot.name)) existing.bots.push(bot.name);
          } else {
            docs.push({ ...d, bots: [bot.name] });
          }
        }
      }
      setAllDocs(docs);
    } catch {
      setFetchError("Error al cargar los documentos");
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; fetchData also used for manual refresh
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

  const handleDelete = useCallback(async (docId: string, botId: string) => {
    try {
      const res = await fetch(`/api/whatsapp/bots/${botId}/knowledge/${docId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Error al eliminar");
      }
      success("Documento eliminado");
      fetchData();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al eliminar");
    }
  }, [success, toastError, fetchData]);

  const docColumns: TableColumn<Doc>[] = useMemo(() => [
    {
      key: "title",
      header: "Documento",
      render: (doc) => (
        <>
          <span className="font-medium text-sm">{doc.title}</span>
          {doc.sourceName && <span className="text-xs text-muted-darker ml-2">{doc.sourceName}</span>}
        </>
      ),
    },
    {
      key: "chunkIndex",
      header: "Chunk",
      render: (doc) => <span className="text-xs font-mono">{doc.chunkIndex}</span>,
      hideBelow: "sm",
    },
    {
      key: "bots",
      header: "Bots",
      render: (doc) => (
        <div className="flex flex-wrap gap-1">
          {doc.bots.map((b) => (
            <Badge key={b} tone="neutral" size="sm">{b}</Badge>
          ))}
        </div>
      ),
      hideBelow: "sm",
    },
    {
      key: "createdAt",
      header: "Fecha",
      render: (doc) => (
        <span className="text-xs text-muted-darker">
          {new Date(doc.createdAt).toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}
        </span>
      ),
      hideBelow: "md",
    },
  ], []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Base de Conocimiento"
        description="Sube documentos para que los bots con RAG activado puedan buscar información antes de responder."
      />

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
                  <Select
                    id={id}
                    value={selectedBotId}
                    onChange={(e) => setSelectedBotId(e.target.value)}
                    placeholder="Seleccionar bot..."
                  >
                    {bots.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.waAccount?.name})
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
            </div>
            <FormField label="Archivo" hint=".txt, .md, .csv, .json (máx 10MB)">
              {(id) => (
                <input
                  id={id}
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
          <Table
            columns={docColumns}
            rows={allDocs}
            rowKey={(doc) => `${doc.id}-${doc.chunkIndex}`}
            loading={loading}
            error={fetchError}
            onRetry={fetchData}
            emptyIcon={Database}
            emptyTitle="Sin documentos"
            emptyDescription="Sube archivos para empezar."
            mobileCard={(doc) => {
              const botsCol = docColumns.find((c) => c.key === "bots")!;
              const createdAt = docColumns.find((c) => c.key === "createdAt")!;
              return (
                <div className="space-y-1.5 min-w-0">
                  <div>
                    <span className="font-medium text-sm">{doc.title}</span>
                    {doc.sourceName && <span className="text-xs text-muted-darker ml-2">{doc.sourceName}</span>}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono text-muted-darker">Chunk {doc.chunkIndex}</span>
                    {createdAt.render(doc)}
                  </div>
                  {botsCol.render(doc)}
                </div>
              );
            }}
            rowActions={(doc) => {
              const firstBotId = bots.find((b) => doc.bots.includes(b.name))?.id;
              if (!firstBotId) return null;
              return (
                <DropdownItem icon={Trash2} onClick={() => handleDelete(doc.id, firstBotId)}>
                  Eliminar
                </DropdownItem>
              );
            }}
          />
        </CardBody>
      </Card>
    </div>
  );
}
