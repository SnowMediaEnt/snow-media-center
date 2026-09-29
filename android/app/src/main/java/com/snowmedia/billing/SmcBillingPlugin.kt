package com.snowmedia.billing

import android.content.Intent
import android.net.Uri
import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.snowmedia.AppLocale
import com.snowmedia.BuildConfig
import com.snowmedia.R
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Capacitor bridge for the SMC billing account (docs/API.md).
 *
 * This class owns three things and nothing else: the secure store (token,
 * device id, pending invoice), the threads the network calls run on, and the
 * translation of [BillingError] into a rejected call the web layer can switch
 * on by `code`. All HTTP lives in [BillingApi]; all waiting lives in [Poller].
 *
 * Every method resolves with the API's own JSON shape (the model's `raw`), so
 * the TypeScript types in src/capacitor/SmcBilling.ts mirror API.md field for
 * field and there is no second schema to keep in step.
 *
 * Rejections carry `code`, `status`, `details` as the call's data payload,
 * e.g. `{code:"rate_limited", status:429, details:{retry_after:60}}`. An auth
 * failure (expired or revoked token) clears the stored session before it is
 * reported, so the web layer's next `getState()` already says signed-out.
 *
 * Nothing in this file logs a request or response body. Only error codes and
 * HTTP statuses reach logcat.
 */
@CapacitorPlugin(name = "SmcBilling")
class SmcBillingPlugin : Plugin() {

    private val io: ExecutorService = Executors.newSingleThreadExecutor { r -> Thread(r, "smc-billing") }
    private val pollers: ExecutorService = Executors.newCachedThreadPool { r -> Thread(r, "smc-billing-poll") }
    private val tickets = ConcurrentHashMap<String, Poller.Ticket>()

    private lateinit var store: SecureStore
    private lateinit var api: BillingApi

    private val configured: Boolean
        get() = BuildConfig.SMC_BILLING_APP_KEY.isNotBlank() && BuildConfig.SMC_BILLING_BASE_URL.isNotBlank()

    override fun load() {
        // Its messages come from strings.xml in the app's language; make sure AppLocale has a Context.
        AppLocale.attach(context)
        store = SecureStore.get(context)
        api = BillingApi(
            baseUrl = BuildConfig.SMC_BILLING_BASE_URL,
            appKey = BuildConfig.SMC_BILLING_APP_KEY,
            deviceId = store.deviceId,
            tokenProvider = { store.token },
        )
    }

    // ── state ──────────────────────────────────────────────────────────────

    @PluginMethod
    fun getState(call: PluginCall) {
        call.resolve(stateJson())
    }

    private fun stateJson(): JSObject = JSObject()
        .put("configured", configured)
        .put("signedIn", store.signedIn)
        .put("email", store.email ?: JSONObject.NULL)
        .put("tokenExpiresAt", store.tokenExpiresAt ?: JSONObject.NULL)
        .put("pendingInvoice", store.pendingInvoice?.let { js(it) } ?: JSONObject.NULL)

    /**
     * Can this device open an https link in a browser or Custom Tab? Fire TV
     * often cannot; the web layer then shows a QR code instead of calling
     * Browser.open and watching it fail.
     */
    @PluginMethod
    fun canOpenUrl(call: PluginCall) {
        val url = call.getString("url") ?: "https://example.com/"
        val ok = try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
            intent.addCategory(Intent.CATEGORY_BROWSABLE)
            context.packageManager.resolveActivity(intent, 0) != null
        } catch (e: Exception) {
            false
        }
        call.resolve(JSObject().put("available", ok))
    }

    // ── auth ───────────────────────────────────────────────────────────────

    @PluginMethod
    fun register(call: PluginCall) {
        val email = call.getString("email")
        val password = call.getString("password")
        val first = call.getString("firstName")
        val last = call.getString("lastName")
        if (email.isNullOrBlank() || password.isNullOrEmpty() || first.isNullOrBlank() || last.isNullOrBlank()) {
            reject(call, BillingError("validation_error", BillingError.text("validation_error", R.string.billing_register_required), 422))
            return
        }
        run(call) {
            val s = api.register(email, password, first, last, call.getString("phone"), call.getString("country"))
            adopt(s)
            JSObject().put("client", js(s.client.raw)).put("expiresAt", s.expiresAt ?: JSONObject.NULL)
        }
    }

    @PluginMethod
    fun login(call: PluginCall) {
        val email = call.getString("email")
        val password = call.getString("password")
        if (email.isNullOrBlank() || password.isNullOrEmpty()) {
            reject(call, BillingError("validation_error", BillingError.text("validation_error", R.string.billing_login_required), 422))
            return
        }
        run(call) {
            val s = api.login(email, password)
            adopt(s)
            JSObject().put("client", js(s.client.raw)).put("expiresAt", s.expiresAt ?: JSONObject.NULL)
        }
    }

    /** Best-effort revoke, then forget. The viewer is signed out either way. */
    @PluginMethod
    fun logout(call: PluginCall) {
        cancelAllPolls()
        run(call) {
            if (store.signedIn) {
                try { api.logout() } catch (e: BillingError) { /* already gone, offline, whatever: not the user's problem */ }
            }
            store.clearSession()
            stateJson()
        }
    }

    @PluginMethod
    fun me(call: PluginCall) = run(call) {
        val c = api.me()
        store.email = c.email
        JSObject().put("client", js(c.raw))
    }

    // ── catalogue / services ───────────────────────────────────────────────

    @PluginMethod
    fun plans(call: PluginCall) = run(call) { js(api.plans().raw) }

    @PluginMethod
    fun startTrial(call: PluginCall) = run(call) { js(api.startTrial().raw) }

    @PluginMethod
    fun services(call: PluginCall) = run(call) {
        val list = api.services()
        val arr = JSONArray()
        for (s in list) arr.put(s.raw)
        JSObject().put("services", arr)
    }

    @PluginMethod
    fun service(call: PluginCall) {
        val id = call.num("serviceId") ?: return reject(call, missing("serviceId"))
        run(call) { JSObject().put("service", js(api.service(id).raw)) }
    }

    @PluginMethod
    fun renew(call: PluginCall) {
        val id = call.num("serviceId") ?: return reject(call, missing("serviceId"))
        run(call) {
            val r = api.renew(id)
            if (!r.paid) {
                store.pendingInvoice = pending("renew", r.invoiceId, serviceId = id, planName = null)
            }
            js(r.raw)
        }
    }

    @PluginMethod
    fun order(call: PluginCall) {
        val planId = call.num("planId") ?: return reject(call, missing("planId"))
        run(call) {
            val r = api.order(planId)
            val inv = r.invoiceId
            if (inv != null) {
                store.pendingInvoice = pending("order", inv, serviceId = r.serviceId, planName = r.plan?.name)
            }
            js(r.raw)
        }
    }

    // ── invoices ───────────────────────────────────────────────────────────

    @PluginMethod
    fun invoice(call: PluginCall) {
        val id = call.num("invoiceId") ?: return reject(call, missing("invoiceId"))
        run(call) { js(api.invoice(id).raw) }
    }

    /** Mints a fresh one-time pay_url. The web layer must open it at once and never keep it. */
    @PluginMethod
    fun payUrl(call: PluginCall) {
        val id = call.num("invoiceId") ?: return reject(call, missing("invoiceId"))
        run(call) { js(api.payUrl(id).raw) }
    }

    @PluginMethod
    fun redeem(call: PluginCall) {
        val code = call.getString("code")?.trim()
        if (code.isNullOrEmpty()) return reject(call, missing("code"))
        run(call) { js(api.redeem(code).raw) }
    }

    // ── pending invoice ────────────────────────────────────────────────────

    @PluginMethod
    fun pendingInvoice(call: PluginCall) {
        call.resolve(JSObject().put("pending", store.pendingInvoice?.let { js(it) } ?: JSONObject.NULL))
    }

    @PluginMethod
    fun clearPendingInvoice(call: PluginCall) {
        store.pendingInvoice = null
        call.resolve()
    }

    // ── polling ────────────────────────────────────────────────────────────

    /**
     * Poll GET /invoices/{id} every 3 s for up to 2 min. Resolves with
     * `{outcome: "paid"|"closed"|"timeout"|"cancelled", invoice, ticks}`.
     * A non-transient API error rejects like any other call.
     */
    @PluginMethod
    fun pollInvoice(call: PluginCall) {
        val id = call.num("invoiceId") ?: return reject(call, missing("invoiceId"))
        val pollId = call.getString("pollId") ?: "invoice:$id"
        val ticket = newTicket(pollId)
        pollers.execute {
            try {
                val outcome = Poller().pollInvoicePaid(api, id, ticket)
                val out = JSObject().put("ticks", outcome.ticks())
                when (outcome) {
                    is Poller.Outcome.Done -> {
                        clearPendingIf(id)
                        out.put("outcome", "paid").put("invoice", js(outcome.value.raw))
                    }
                    is Poller.Outcome.Stopped -> {
                        clearPendingIf(id)
                        out.put("outcome", "closed").put("invoice", js(outcome.value.raw))
                    }
                    is Poller.Outcome.TimedOut -> out.put("outcome", "timeout").put("invoice", outcome.last?.let { js(it.raw) } ?: JSONObject.NULL)
                    is Poller.Outcome.Cancelled -> out.put("outcome", "cancelled").put("invoice", outcome.last?.let { js(it.raw) } ?: JSONObject.NULL)
                    is Poller.Outcome.Failed -> { reject(call, outcome.error); return@execute }
                }
                call.resolve(out)
            } catch (t: Throwable) {
                reject(call, t)
            } finally {
                tickets.remove(pollId, ticket)
            }
        }
    }

    /**
     * Poll GET /services/{id} until it is active with credentials. Resolves
     * with `{outcome: "active"|"terminal"|"timeout"|"cancelled", service, ticks}`.
     */
    @PluginMethod
    fun pollServiceActive(call: PluginCall) {
        val id = call.num("serviceId") ?: return reject(call, missing("serviceId"))
        val pollId = call.getString("pollId") ?: "service:$id"
        val ticket = newTicket(pollId)
        pollers.execute {
            try {
                val outcome = Poller().pollServiceProvisioned(api, id, ticket)
                val out = JSObject().put("ticks", outcome.ticks())
                when (outcome) {
                    is Poller.Outcome.Done -> out.put("outcome", "active").put("service", js(outcome.value.raw))
                    is Poller.Outcome.Stopped -> out.put("outcome", "terminal").put("service", js(outcome.value.raw))
                    is Poller.Outcome.TimedOut -> out.put("outcome", "timeout").put("service", outcome.last?.let { js(it.raw) } ?: JSONObject.NULL)
                    is Poller.Outcome.Cancelled -> out.put("outcome", "cancelled").put("service", outcome.last?.let { js(it.raw) } ?: JSONObject.NULL)
                    is Poller.Outcome.Failed -> { reject(call, outcome.error); return@execute }
                }
                call.resolve(out)
            } catch (t: Throwable) {
                reject(call, t)
            } finally {
                tickets.remove(pollId, ticket)
            }
        }
    }

    /** Stop one poll by id, or every poll when no id is given. */
    @PluginMethod
    fun cancelPoll(call: PluginCall) {
        val pollId = call.getString("pollId")
        if (pollId == null) cancelAllPolls() else tickets.remove(pollId)?.cancel()
        call.resolve()
    }

    // ── internals ──────────────────────────────────────────────────────────

    private fun newTicket(pollId: String): Poller.Ticket {
        val t = Poller.Ticket()
        tickets.put(pollId, t)?.cancel() // a second poll with the same id replaces the first
        return t
    }

    private fun cancelAllPolls() {
        for (t in tickets.values) t.cancel()
        tickets.clear()
    }

    private fun adopt(s: Session) {
        store.token = s.token
        store.tokenExpiresAt = s.expiresAt
        store.email = s.client.email
    }

    private fun clearPendingIf(invoiceId: Long) {
        val p = store.pendingInvoice ?: return
        if (p.long("invoice_id") == invoiceId) store.pendingInvoice = null
    }

    private fun pending(kind: String, invoiceId: Long, serviceId: Long?, planName: String?): JSONObject =
        JSONObject()
            .put("invoice_id", invoiceId)
            .put("kind", kind)
            .put("service_id", serviceId ?: JSONObject.NULL)
            .put("plan_name", planName ?: JSONObject.NULL)
            .put("created_at", System.currentTimeMillis())

    /**
     * A numeric option from the web layer. The bridge parses the call with
     * org.json, which hands back Integer for anything that fits in 32 bits,
     * and PluginCall.getLong() only accepts a Long — so every WHMCS id came
     * back null through it. Accept any Number.
     */
    private fun PluginCall.num(key: String): Long? = (data.opt(key) as? Number)?.toLong()

    private fun missing(field: String) =
        BillingError("validation_error", BillingError.text("validation_error", R.string.billing_field_required, field), 422, JSONObject().put("field", field))

    /** Run [block] off the main thread; resolve with its result or reject with its error. */
    private fun run(call: PluginCall, block: () -> JSObject) {
        if (!configured) {
            reject(call, BillingError("not_configured", BillingError.text("not_configured", R.string.billing_not_configured), 0))
            return
        }
        io.execute {
            try {
                call.resolve(block())
            } catch (t: Throwable) {
                reject(call, t)
            }
        }
    }

    private fun reject(call: PluginCall, t: Throwable) {
        val e = when (t) {
            is BillingError -> t
            is ParseException -> BillingError.badResponse(200, t.message ?: "unexpected shape", t)
            else -> BillingError("internal", BillingError.text("internal", R.string.billing_internal), 0, null, t)
        }
        if (e.isAuthError) {
            // The token is dead. Forget it so the next getState() says signed-out
            // instead of the app re-sending a bad bearer on every screen.
            cancelAllPolls()
            store.clearSession()
        }
        // Code and status only. Never the body, never the message the user typed.
        Log.w(TAG, "billing call failed: ${e.code} (${e.status})")
        call.reject(e.message ?: e.code, e.code, null, js(e.toJson()))
    }

    private fun js(o: JSONObject): JSObject = JSObject.fromJSONObject(o)

    private fun Poller.Outcome<*>.ticks(): Int = when (this) {
        is Poller.Outcome.Done -> ticks
        is Poller.Outcome.Stopped -> ticks
        is Poller.Outcome.TimedOut -> ticks
        is Poller.Outcome.Failed -> ticks
        is Poller.Outcome.Cancelled -> ticks
    }

    companion object {
        private const val TAG = "SmcBilling"
    }
}
