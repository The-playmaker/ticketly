import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { GlobalRole, OrgRole } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
      globalRole: GlobalRole;
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
    id: string;
    globalRole: GlobalRole;
    memberships: {
      organizationId: string;
      role: OrgRole;
      canRefund: boolean;
      isActive: boolean;
    }[];
  }
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

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

        if (!user?.passwordHash || !user.isActive) return null;

        const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim(),
          image: user.image,
          globalRole: user.globalRole,
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
        token.memberships = user.memberships ?? [];
      }

      // Refresh memberships periodically / on update
      if (trigger === "update" && token.id) {
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
        if (fresh) {
          token.globalRole = fresh.globalRole;
          token.memberships = fresh.memberships;
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.globalRole = token.globalRole;
        session.user.memberships = token.memberships ?? [];
      }
      return session;
    },
  },
  trustHost: true,
});
