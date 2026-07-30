// Shared Wix member lookup used by `wix-integration` and `check-account-email`.
// Keep this the single source of truth — do not duplicate the logic.

export const normalizeEmail = (value?: string | null) => value?.toLowerCase().trim() || '';

export function emailFromContact(contact: any): string {
  return normalizeEmail(
    contact?.primaryInfo?.email ||
    contact?.info?.emails?.items?.[0]?.email ||
    contact?.info?.emails?.[0]?.email ||
    contact?.emails?.items?.[0]?.email
  );
}

export async function findWixMemberByEmail(
  email: string,
  wixApiKey: string,
  wixSiteId: string,
  wixAccountId?: string,
) {
  const normalizedEmail = normalizeEmail(email);
  let totalScanned = 0;
  const PAGE_SIZE = 100;
  const MAX_PAGES = 50;

  for (let page = 0; page < MAX_PAGES; page++) {
    const memberResponse = await fetch('https://www.wixapis.com/members/v1/members/query', {
      method: 'POST',
      headers: {
        'Authorization': wixApiKey,
        'wix-site-id': wixSiteId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: {
          filter: { loginEmail: { $eq: normalizedEmail } },
          paging: { limit: PAGE_SIZE, offset: page * PAGE_SIZE },
        },
        fieldsets: ['FULL'],
      })
    });

    if (memberResponse.status === 404) break;
    if (!memberResponse.ok) {
      const errorText = await memberResponse.text();
      console.error('Wix members lookup error:', memberResponse.status, errorText);
      throw new Error(`Wix members lookup failed: ${memberResponse.status}`);
    }

    const memberData = await memberResponse.json();
    const batch = memberData.members || [];
    totalScanned += batch.length;
    const matchingMember = batch.find((m: any) => normalizeEmail(m.loginEmail) === normalizedEmail);
    if (matchingMember) {
      console.log(`Found Wix member on page ${page}: id=${matchingMember.id}, status=${matchingMember.status}`);
      return { source: 'members', member: matchingMember, totalScanned };
    }
    if (page === 0 && batch.length === PAGE_SIZE) {
      console.warn('Wix members query returned a full non-matching page; falling back to contacts lookup');
      break;
    }
    if (batch.length < PAGE_SIZE) break;
  }

  console.log(`Members lookup scanned ${totalScanned} members for ${normalizedEmail}; trying contacts fallback`);

  if (wixAccountId) {
    for (const filter of [
      { 'info.emails.email': { $eq: normalizedEmail } },
      { 'primaryInfo.email': { $eq: normalizedEmail } },
    ]) {
      const contactResponse = await fetch('https://www.wixapis.com/contacts/v4/contacts/query', {
        method: 'POST',
        headers: {
          'Authorization': wixApiKey,
          'wix-account-id': wixAccountId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: { filter, paging: { limit: 5 } } }),
      });

      if (!contactResponse.ok) {
        console.warn('Wix contact lookup non-OK:', contactResponse.status, await contactResponse.text());
        continue;
      }

      const contactData = await contactResponse.json();
      const contacts = contactData.contacts || [];
      const contact = contacts.find((c: any) => emailFromContact(c) === normalizedEmail);
      if (contact) {
        console.log(`Found Wix contact fallback: id=${contact.id}, email=${normalizedEmail}`);
        return {
          source: 'contacts',
          totalScanned,
          member: {
            id: contact.id,
            contactId: contact.id,
            loginEmail: normalizedEmail,
            status: 'APPROVED',
            profile: {
              firstName: contact.info?.name?.first || '',
              lastName: contact.info?.name?.last || '',
              nickname: contact.info?.name?.first || normalizedEmail.split('@')[0],
            },
            contact,
          },
        };
      }
    }
  }

  return { source: 'none', member: null, totalScanned };
}
