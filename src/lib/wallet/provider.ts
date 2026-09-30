/**
 * Wallet pass provider stub — Apple Wallet / Google Wallet can plug in later
 * without changing ticket issuance.
 */
export interface WalletPassProvider {
  createPass(input: {
    ticketPublicId: string;
    secureToken: string;
    eventName: string;
    startsAt: Date;
    holderName: string;
    venue: string;
  }): Promise<{ downloadUrl: string }>;
}

export class StubWalletPassProvider implements WalletPassProvider {
  async createPass(): Promise<{ downloadUrl: string }> {
    throw new Error("Wallet pass not implemented yet (Apple/Google Wallet TODO)");
  }
}
