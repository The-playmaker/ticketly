/** Auto-restored by restore-check-in-service.mjs (prebuild/pretypecheck). */
export type CheckInEventAccess = {
  canAccessEvent: (event: { id: string; organizationId: string; name: string }) => boolean;
};
export type CheckInResponse = {
  result: string;
  message: string;
  [key: string]: unknown;
};
export class CheckInService {
  static async checkInByToken(_input: Record<string, unknown>): Promise<CheckInResponse> {
    throw new Error("check-in-service not restored — run restore-check-in-service.mjs");
  }
  static async checkInByTicketId(_input: Record<string, unknown>): Promise<CheckInResponse> {
    throw new Error("check-in-service not restored — run restore-check-in-service.mjs");
  }
  static async searchGuests(_eventId: string, _query: string) {
    return [];
  }
}
