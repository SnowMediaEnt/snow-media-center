// Shared giveaway helpers
// (sync-credit-orders) and giveaway-bridge.
//
// Awarding is ALWAYS idempotent: it goes through the service-role-only
// giveaway_award_entry RPC, whose insert is ON CONFLICT DO NOTHING against the
// dedupe unique indexes (per type + source_id for purchases, per user/customer
// for base entries). Callers must pass a SERVICE-ROLE client.

export interface GiveawayRule {
  patterns: string[];
  entry_type: string; // 'renewal' | 'device_purchase' | ...
  entries: number; // entries granted per renewal line / per device unit
}

export interface ActiveGiveaway {
  id: string;
  slug: string;
  name: string;
  status: string;
  start_at: string | null;
  end_at: string | null;
  config: {
    purchase_rules?: GiveawayRule[];
    excluded_buyer_emails?: string[];
  } & Record<string, unknown>;
}

// AI credit products are credit purchases, NOT giveaway-eligible purchases.
const AI_CREDIT_SKUS = new Set(['ai50', 'ai120', 'ai250', 'ai600']);

// deno-lint-ignore no-explicit-any
export async function getActiveGiveaway(admin: any): Promise<ActiveGiveaway | null> {
  const { data, error } = await admin
    .from('giveaways')
    .select('id,slug,name,status,start_at,end_at,config')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(5);
  if (error || !data || data.length === 0) return null;
  const now = Date.now();
  for (const g of data as ActiveGiveaway[]) {
    const starts = g.start_at ? Date.parse(g.start_at) : null;
    const ends = g.end_at ? Date.parse(g.end_at) : null;
    if ((starts === null || starts <= now) && (ends === null || ends >= now)) return g;
  }
  return null;
}

// Classify an order's line items against the giveaway's purchase_rules.
// Returns e.g. { renewal: 1, device_purchase: 2 } where renewal counts matching
// ITEMS (1 per item regardless of quantity) and device_purchase counts UNITS.
// deno-lint-ignore no-explicit-any
export function classifyLineItems(
  // deno-lint-ignore no-explicit-any
  order: any,
  config: ActiveGiveaway['config'] | undefined,
): Record<string, number> {
  const rules: GiveawayRule[] = (config?.purchase_rules as GiveawayRule[]) || [];
  const counts: Record<string, number> = {};
  // deno-lint-ignore no-explicit-any
  const items: any[] = order?.lineItems || order?.line_items || [];
  for (const item of items) {
    const sku = String(item?.physicalProperties?.sku || item?.sku || '').toLowerCase().trim();
    if (AI_CREDIT_SKUS.has(sku)) continue;
    const name = String(item?.productName?.original || item?.productName || item?.name || '').toLowerCase();
    const qty = Math.max(1, Number(item?.quantity || 1) || 1);
    for (const rule of rules) {
      const patterns = (rule?.patterns || []).map((p) => String(p).toLowerCase()).filter(Boolean);
      const hit = patterns.some((p) => (sku && sku.includes(p)) || (name && name.includes(p)));
      if (!hit) continue;
      const inc = rule.entry_type === 'device_purchase' ? qty : 1;
      counts[rule.entry_type] = (counts[rule.entry_type] || 0) + inc;
      break; // first matching rule wins per item
    }
  }
  return counts;
}

export interface AwardIdentity {
  userId: string | null;
  customerId: string | null;
  buyerEmail: string | null;
}

// Awards giveaway entries for one paid order. Guards: no active giveaway
// (caller), order total <= 0, buyer in config.excluded_buyer_emails, orders
// outside the giveaway window. Entries land 'valid' when we know who the buyer
// is, 'pending' otherwise. Never throws.
// deno-lint-ignore no-explicit-any
export async function awardOrderEntries(
  // deno-lint-ignore no-explicit-any
  admin: any,
  giveaway: ActiveGiveaway | null,
  // deno-lint-ignore no-explicit-any
  order: any,
  ident: AwardIdentity,
): Promise<{ awarded: number; skipped?: string }> {
  if (!giveaway) return { awarded: 0, skipped: 'no_active_giveaway' };
  const config = giveaway.config || {};

  // Skip free / zero-total orders.
  const totalRaw = order?.priceSummary?.total?.amount ?? order?.totals?.total ?? order?.total;
  const total = totalRaw === undefined || totalRaw === null ? NaN : Number(totalRaw);
  if (!Number.isNaN(total) && total <= 0) return { awarded: 0, skipped: 'non_positive_total' };

  // Skip orders placed outside the giveaway window (protects the login-time
  // sync path from back-awarding historical orders).
  const createdRaw = order?.createdDate || order?.createdAt || order?.created_at;
  const created = createdRaw ? Date.parse(createdRaw) : NaN;
  if (!Number.isNaN(created)) {
    if (giveaway.start_at && created < Date.parse(giveaway.start_at)) return { awarded: 0, skipped: 'before_window' };
    if (giveaway.end_at && created > Date.parse(giveaway.end_at)) return { awarded: 0, skipped: 'after_window' };
  }

  const buyer = (ident.buyerEmail || '').toLowerCase().trim();
  const excluded = ((config.excluded_buyer_emails as string[]) || []).map((e) => String(e).toLowerCase().trim());
  if (buyer && excluded.includes(buyer)) return { awarded: 0, skipped: 'excluded_buyer' };

  const orderId = String(order?.id || order?._id || '');
  if (!orderId) return { awarded: 0, skipped: 'no_order_id' };
  const orderNumber = order?.number || order?.orderNumber || orderId;

  const counts = classifyLineItems(order, config);
  if (Object.keys(counts).length === 0) return { awarded: 0, skipped: 'no_matching_items' };

  const status = ident.userId || ident.customerId ? 'valid' : 'pending';
  const rules: GiveawayRule[] = (config.purchase_rules as GiveawayRule[]) || [];

  let awarded = 0;
  for (const [type, qty] of Object.entries(counts)) {
    if (qty <= 0) continue;
    const rule = rules.find((r) => r.entry_type === type);
    const per = Math.max(1, Number(rule?.entries || 1) || 1);
    // renewal: the matched rule's entries per order; devices: entries per unit.
    const entryCount = type === 'device_purchase' ? per * qty : per;
    try {
      const { data, error } = await admin.rpc('giveaway_award_entry', {
        p_giveaway_id: giveaway.id,
        p_user_id: ident.userId,
        p_customer_id: ident.customerId,
        p_type: type,
        p_count: entryCount,
        p_source_id: orderId,
        p_source_ref: `Order #${orderNumber}`,
        p_status: status,
        p_metadata: { buyer_email: buyer || null },
      });
      if (error) {
        console.error(`[giveaway] award rpc error (${type}/${orderId}):`, error.message);
        continue;
      }
      if (data) awarded++; // null = dedupe no-op
    } catch (e) {
      console.error(`[giveaway] award threw (${type}/${orderId}):`, e instanceof Error ? e.message : String(e));
    }
  }
  return awarded > 0 ? { awarded } : { awarded: 0, skipped: 'duplicate_or_failed' };
}
