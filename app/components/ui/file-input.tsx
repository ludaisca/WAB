"use client";

import React, { useState, useRef, useCallback } from "react";
import { Upload, X, File, Image as ImageIcon } from "lucide-react";
import { cn } from "./cn";

interface FileInputProps {
  accept?: string;
  multiple?: boolean;
  onChange?: (files: File[]) => void;
  disabled?: boolean;
  error?: string;
  className?: string;
  label?: string;
  hint?: string;
  maxSizeMB?: number;
  preview?: boolean;
}

export function FileInput({
  accept,
  multiple = false,
  onChange,
  disabled,
  error,
  className,
  label = "Arrastra archivos o haz clic para subir",
  hint,
  maxSizeMB = 10,
  preview = true,
}: FileInputProps) {
  const [dragOver, setDragOver] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFiles = useCallback(
    (newFiles: FileList | null) => {
      if (!newFiles || newFiles.length === 0) return;
      const arr = Array.from(newFiles).filter((f) => {
        if (maxSizeMB && f.size > maxSizeMB * 1024 * 1024) return false;
        return true;
      });
      if (arr.length === 0) return;
      setFiles(arr);
      onChange?.(arr);

      if (preview) {
        const urls = arr.map((f) => URL.createObjectURL(f));
        setPreviews((prev) => {
          prev.forEach((u) => URL.revokeObjectURL(u));
          return urls;
        });
      }
    },
    [onChange, maxSizeMB, preview]
  );

  const removeFile = useCallback(
    (index: number) => {
      const next = files.filter((_, i) => i !== index);
      setFiles(next);
      if (preview) {
        setPreviews((prev) => {
          if (prev[index]) URL.revokeObjectURL(prev[index]);
          return prev.filter((_, i) => i !== index);
        });
      }
      onChange?.(next);
    },
    [files, onChange, preview]
  );

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return (
    <div className={cn("space-y-3", className)}>
      <div
        onDragEnter={(e) => { handleDrag(e); setDragOver(true); }}
        onDragLeave={(e) => { handleDrag(e); setDragOver(false); }}
        onDragOver={handleDrag}
        onDrop={(e) => {
          handleDrag(e);
          setDragOver(false);
          if (!disabled) processFiles(e.dataTransfer.files);
        }}
        onClick={() => !disabled && inputRef.current?.click()}
        className={cn(
          "relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 transition-colors cursor-pointer",
          dragOver
            ? "border-accent bg-accent/5"
            : error
            ? "border-danger-border bg-danger-bg/30"
            : "border-border hover:border-accent/40 hover:bg-surface-light",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={(e) => processFiles(e.target.files)}
          disabled={disabled}
          className="hidden"
        />

        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10">
          <Upload size={22} className="text-accent" />
        </div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        {hint && <p className="text-xs text-muted-darker">{hint}</p>}
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((file, i) => (
            <div
              key={`${file.name}-${i}`}
              className="flex items-center gap-3 rounded-lg border border-border bg-surface-light px-3 py-2"
            >
              {preview && previews[i] && file.type.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element -- local blob: preview URL, not supported by next/image
                <img
                  src={previews[i]}
                  alt={file.name}
                  className="h-9 w-9 rounded object-cover"
                />
              ) : file.type.startsWith("image/") ? (
                <ImageIcon size={18} className="text-muted-darker shrink-0" />
              ) : (
                <File size={18} className="text-muted-darker shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground truncate">{file.name}</p>
                <p className="text-xs text-muted-darker">
                  {(file.size / 1024).toFixed(0)} KB
                </p>
              </div>
              <button
                type="button"
                onClick={() => removeFile(i)}
                className="text-muted-darker hover:text-danger transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
