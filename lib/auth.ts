import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { rateLimit } from "./rate-limit";
import { credentialRevision } from "./auth-session";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Contraseña", type: "password" },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) return null;

        const forwarded = request.headers.get("x-forwarded-for");
        const ip = forwarded?.split(",")[0]?.trim() ?? "unknown";
        const { allowed } = await rateLimit(`login:${ip}`, 5, 60);
        if (!allowed) return null;

        const email = (credentials.email as string).toLowerCase().trim();
        const password = credentials.password as string;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.password) return null;

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          createdAt: user.createdAt.toISOString(),
          credentialRevision: credentialRevision(user.password, user.role),
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role ?? "user";
        token.createdAt = (user as { createdAt?: string }).createdAt;
        token.credentialRevision = (user as { credentialRevision?: string }).credentialRevision;
      }
      // Se revalida también en sesiones existentes: bajas, cambios de rol y
      // contraseña invalidan los JWT anteriores. Las sesiones legacy sin
      // revisión requieren iniciar sesión una vez tras esta actualización.
      if (typeof token.id !== "string" || typeof token.credentialRevision !== "string") return null;
      const current = await prisma.user.findUnique({
        where: { id: token.id },
        select: { password: true, role: true, name: true, email: true },
      });
      if (!current?.password || credentialRevision(current.password, current.role) !== token.credentialRevision) return null;
      token.role = current.role;
      token.name = current.name;
      token.email = current.email;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
        (session.user as { createdAt?: string }).createdAt = token.createdAt as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
