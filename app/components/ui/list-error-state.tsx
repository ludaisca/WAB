import { RefreshCw } from "lucide-react";
import { Banner } from "./banner";
import { Button } from "./button";

interface ListErrorStateProps {
  message?: string;
  onRetry: () => void;
  retryLabel?: string;
  className?: string;
}

export function ListErrorState({
  message = "No se pudieron cargar los datos.",
  onRetry,
  retryLabel = "Reintentar",
  className,
}: ListErrorStateProps) {
  return (
    <Banner
      tone="danger"
      title="Error al cargar"
      className={className}
      action={
        <Button variant="secondary" size="sm" icon={RefreshCw} onClick={onRetry}>
          {retryLabel}
        </Button>
      }
    >
      {message}
    </Banner>
  );
}
