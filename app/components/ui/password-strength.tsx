import { cn } from "./cn";

function getStrength(password: string): { score: number; label: string; color: string } {
  if (!password) return { score: 0, label: "", color: "" };

  let score = 0;
  if (password.length >= 8)  score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 1) return { score: 1, label: "Muy débil", color: "bg-danger" };
  if (score <= 2) return { score: 2, label: "Débil",     color: "bg-warning" };
  if (score <= 3) return { score: 3, label: "Regular",   color: "bg-warning" };
  if (score <= 4) return { score: 4, label: "Fuerte",    color: "bg-success" };
  return           { score: 5, label: "Muy fuerte",       color: "bg-success" };
}

interface PasswordStrengthProps {
  password: string;
  className?: string;
}

export function PasswordStrength({ password, className }: PasswordStrengthProps) {
  const { score, label, color } = getStrength(password);
  if (!password) return null;

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-300",
              i <= score ? color : "bg-surface-light"
            )}
          />
        ))}
      </div>
      <p className="text-xs text-muted-darker">{label}</p>
    </div>
  );
}
