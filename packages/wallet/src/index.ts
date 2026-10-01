import type { WalletProviderKind } from "@ticketly/shared-types";

export type CreateWalletPassInput = {
  ticketPublicId: string;
  secureToken: string;
  eventName: string;
  startsAt: Date;
  endsAt?: Date;
  holderName: string;
  venue: string;
  organizationName: string;
};

export type WalletPassResult = {
  provider: WalletProviderKind;
  downloadUrl?: string;
  externalId?: string;
  status: "ISSUED" | "UNAVAILABLE";
  reason?: string;
};

/**
 * WalletPassProvider — Apple Wallet / Google Wallet.
 *
 * Do NOT simulate passes when certificates / issuer IDs are missing.
 * Callers must handle UNAVAILABLE and hide "Add to Wallet" UI.
 */
export interface WalletPassProvider {
  readonly kind: WalletProviderKind;
  isConfigured(): boolean;
  createPass(input: CreateWalletPassInput): Promise<WalletPassResult>;
  revokePass?(externalId: string): Promise<void>;
}

export class AppleWalletProvider implements WalletPassProvider {
  readonly kind = "APPLE" as const;

  isConfigured(): boolean {
    return Boolean(
      process.env.APPLE_WALLET_PASS_TYPE_ID &&
        process.env.APPLE_WALLET_TEAM_ID &&
        process.env.APPLE_WALLET_CERT_PATH
    );
  }

  async createPass(_input: CreateWalletPassInput): Promise<WalletPassResult> {
    if (!this.isConfigured()) {
      return {
        provider: "APPLE",
        status: "UNAVAILABLE",
        reason: "Apple Wallet certificates not configured",
      };
    }
    // TODO: generate .pkpass with passkit / sign with WWDR
    throw new Error("Apple Wallet pass generation not implemented yet (certs present).");
  }
}

export class GoogleWalletProvider implements WalletPassProvider {
  readonly kind = "GOOGLE" as const;

  isConfigured(): boolean {
    return Boolean(
      process.env.GOOGLE_WALLET_ISSUER_ID && process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON
    );
  }

  async createPass(_input: CreateWalletPassInput): Promise<WalletPassResult> {
    if (!this.isConfigured()) {
      return {
        provider: "GOOGLE",
        status: "UNAVAILABLE",
        reason: "Google Wallet issuer credentials not configured",
      };
    }
    // TODO: Google Wallet Objects API
    throw new Error("Google Wallet pass generation not implemented yet (creds present).");
  }
}

export function getWalletProviders(): WalletPassProvider[] {
  return [new AppleWalletProvider(), new GoogleWalletProvider()];
}

export function getConfiguredWalletProviders(): WalletPassProvider[] {
  return getWalletProviders().filter((p) => p.isConfigured());
}
