import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import type { GlobalRole, OrgRole } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
      globalRole: GlobalRole;
      isActive: boolean;
      memberships: {
        organizationId: string;
        role: OrgRole;
        canRefund: boolean;
        isActive: boolean;
      }[];
    };
  }

  interface User {
    globalRole: GlobalRole;
    isActive: boolean;
    memberships?: {
      organizationId: string;
      role: OrgRole;
      canRefund: boolean;
      isActive: boolean;
    }[];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id?: string;
    globalRole?: GlobalRole;
    isActive?: boolean;
    disabled?: boolean;
    memberships?: {
      organizationId: string;
      role: OrgRole;
      canRefund: boolean;
      isActive: boolean;
    }[];
    lastActiveTouch?: number;
  }
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const ACTIVE_TOUCH_MS = 5 * 60 * 1000;

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "E-post", type: "email" },
        password: { label: "Passord", type: "password" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email.toLowerCase() },
          include: {
            memberships: {
              where: { isActive: true },
              select: {
                organizationId: true,
                role: true,
                canRefund: true,
                isActive: true,
              },
            },
          },
        });

        // Reject missing, inactive, or passwordless accounts
        if (!user?.passwordHash || !user.isActive) return null;

        const valid = await verifyPassword(parsed.data.password, user.passwordHash);
        if (!valid) return null;

        await prisma.user.update({
          where: { id: user.id },
          data: { lastActiveAt: new Date() },
        });

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim(),
          image: user.image,
          globalRole: user.globalRole,
          isActive: user.isActive,
          memberships: user.memberships,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id!;
        token.globalRole = user.globalRole;
        token.isActive = user.isActive;
        token.memberships = user.memberships ?? [];
        token.disabled = false;
        token.lastActiveTouch = Date.now();
      }

      if (!token.id) return token;

      // Re-check isActive on every JWT refresh so disabled users lose access
      // at the next authorization check (not only on login).
      const fresh = await prisma.user.findUnique({
        where: { id: token.id },
        include: {
          memberships: {
            where: { isActive: true },
            select: {
              organizationId: true,
              role: true,
              canRefund: true,
              isActive: true,
            },
          },
        },
      });

      if (!fresh || !fresh.isActive) {
        return {
          ...token,
          id: undefined,
          disabled: true,
          isActive: false,
          memberships: [],
        };
      }

      token.globalRole = fresh.globalRole;
      token.isActive = true;
      token.disabled = false;
      token.memberships = fresh.memberships;

      if (trigger === "update" || !token.lastActiveTouch || Date.now() - token.lastActiveTouch > ACTIVE_TOUCH_MS) {
        token.lastActiveTouch = Date.now();
        void prisma.user
          .update({ where: { id: fresh.id }, data: { lastActiveAt: new Date() } })
          .catch(() => undefined);
      }

      return token;
    },
    async session({ session, token }) {
      if (token.disabled || !token.id || !token.isActive) {
        // Force unauthenticated session for disabled / revoked users
        return { ...session, user: undefined as unknown as typeof session.user };
      }
      if (session.user) {
        session.user.id = token.id;
        session.user.globalRole = token.globalRole!;
        session.user.isActive = true;
        session.user.memberships = token.memberships ?? [];
      }
      return session;
    },
  },
  trustHost: true,
});
