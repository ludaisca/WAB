import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Transiciones de página nativas (React 19.2 / Next 16). Next dispara
  // document.startViewTransition en las navegaciones del App Router; el
  // cross-fade sutil se estiliza en globals.css (::view-transition-*).
  experimental: {
    viewTransition: true,
  },
  // Next dev blocks cross-origin requests to dev resources (HMR websocket, RSC
  // payloads) by default. Needed while testing through an ngrok tunnel for the
  // Meta webhook, and also for LAN/Tailscale hostnames used to reach this dev
  // server from another machine — without this, HMR/RSC navigation silently
  // fails (e.g. login/onboarding never completes) for any non-localhost host.
  allowedDevOrigins: [
    "*.ngrok-free.dev",
    "*.ngrok-free.app",
    "*.ngrok.io",
    // Nombres por los que se alcanza el dev server. El host se renombró a
    // "ludaisca" el 2026-09-01 (antes "fedora-server", y "rocky-server" antes
    // de eso); la laptop ASUS es "ldic" (antes "asus-fedora").
    "ludaisca",
    "ldic",
    "fedora",
    "192.168.100.101",
  ],
  async headers() {
    // `unsafe-eval` solo se necesita en desarrollo (HMR / React Refresh de
    // Turbopack). En producción el bundle no lo requiere, así que se omite para
    // endurecer la defensa XSS. `unsafe-inline` en style-src se mantiene porque
    // Tailwind y los estilos inline de Next lo necesitan en ambos entornos.
    const scriptSrc =
      process.env.NODE_ENV === "production"
        ? "'self' 'unsafe-inline'"
        : "'self' 'unsafe-inline' 'unsafe-eval'";
    const csp = `default-src 'self'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'`;
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "geolocation=(), microphone=(), camera=()" },
          { key: "Content-Security-Policy", value: csp },
          ...(process.env.NODE_ENV === "production"
            ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
