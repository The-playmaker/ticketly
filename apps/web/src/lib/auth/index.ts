import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";
import { authorizeCredentials } from "@/lib/auth/credentials-authorize";
import { refreshAuthJwt } from "@/lib/auth/jwt-refresh";
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
  }
}

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
        return authorizeCredentials(credentials);
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      return refreshAuthJwt(token, user
        ? {
            id: user.id!,
            globalRole: user.globalRole,
            isActive: user.isActive,
            memberships: user.memberships,
          }
        : null);
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
