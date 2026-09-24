// Stand-in for npm:resend in tests: records what would have been sent.
export interface SentEmail { from?: string; to: string[]; subject: string; html: string }
export const sentEmails: SentEmail[] = [];
export class Resend {
  emails = {
    send: async (email: SentEmail) => {
      sentEmails.push(email);
      return { data: { id: `email-${sentEmails.length}` }, error: null };
    },
  };
  constructor(_apiKey?: string) { /* nothing to set up */ }
}
