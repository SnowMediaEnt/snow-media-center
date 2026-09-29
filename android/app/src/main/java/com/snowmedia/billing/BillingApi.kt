package com.snowmedia.billing

import com.snowmedia.R
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Client for the SMC Account API (docs/API.md, build 1.1.0).
 *
 * Pure Kotlin + OkHttp: no Android types, so the whole thing runs under a
 * plain JVM against MockWebServer in the unit tests. The Capacitor plugin is
 * a thin wrapper that owns storage and threads.
 *
 * What this class guarantees to its callers:
 *
 *   • Every call either returns a typed model or throws [BillingError] with
 *     a stable code. Nothing else escapes — not JSONException, not
 *     IOException, not a NumberFormatException from a string price.
 *   • Headers: X-SMC-App-Key and X-SMC-Device on every request, Authorization
 *     on user endpoints. The token is read through [tokenProvider] at call
 *     time, so a sign-out mid-flight is honoured.
 *   • Timeouts: 30 s. /trial and /orders get 60 s — the server provisions the
 *     panel line synchronously on /trial (2–5 s, occasionally much longer).
 *   • Retry: idempotent GETs are retried ONCE, only on a network failure
 *     (IOException before a response arrived). A POST is never retried here:
 *     /trial and /orders are guarded server-side, but a blind retry of
 *     /redeem or /renew would be a second attempt at spending money.
 *   • A 2xx whose body is not the JSON we expect — an HTML page from a
 *     proxy, a truncated body, a missing required field — is a
 *     `bad_response` error, never a crash.
 *
 * Nothing here logs. Passwords, tokens, gift codes and panel credentials pass
 * through this class and must not end up in logcat.
 */
class BillingApi(
    baseUrl: String,
    private val appKey: String,
    private val deviceId: String,
    private val tokenProvider: () -> String?,
    client: OkHttpClient? = null,
    /** Injectable for tests so the retry delay does not really sleep. */
    private val sleep: (Long) -> Unit = { Thread.sleep(it) },
) {
    private val base = baseUrl.trimEnd('/')
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    private val standard: OkHttpClient = (client ?: OkHttpClient())
        .newBuilder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(STANDARD_TIMEOUT_S, TimeUnit.SECONDS)
        .writeTimeout(STANDARD_TIMEOUT_S, TimeUnit.SECONDS)
        .callTimeout(STANDARD_TIMEOUT_S, TimeUnit.SECONDS)
        .retryOnConnectionFailure(false) // we decide, per method, below
        .build()

    private val slow: OkHttpClient = standard.newBuilder()
        .readTimeout(SLOW_TIMEOUT_S, TimeUnit.SECONDS)
        .writeTimeout(SLOW_TIMEOUT_S, TimeUnit.SECONDS)
        .callTimeout(SLOW_TIMEOUT_S, TimeUnit.SECONDS)
        .build()

    // ── auth ───────────────────────────────────────────────────────────────

    fun register(email: String, password: String, firstName: String, lastName: String, phone: String? = null, country: String? = null): Session {
        val body = JSONObject()
            .put("email", email.trim())
            .put("password", password)
            .put("first_name", firstName.trim())
            .put("last_name", lastName.trim())
        if (!phone.isNullOrBlank()) body.put("phone", phone.trim())
        if (!country.isNullOrBlank()) body.put("country", country.trim())
        val j = post("/auth/register", body, auth = false)
        return parsing { Session.parse(j) }
    }

    fun login(email: String, password: String): Session {
        val j = post("/auth/login", JSONObject().put("email", email.trim()).put("password", password), auth = false)
        return parsing { Session.parse(j) }
    }

    /** Revokes the current token. Server errors here are not the user's problem; see the plugin. */
    fun logout() { post("/auth/logout", null) }

    fun me(): Client {
        val j = get("/me")
        return parsing { Client.parse(j.obj("client") ?: throw ParseException("Missing 'client'")) }
    }

    // ── catalogue ──────────────────────────────────────────────────────────

    fun plans(): PlansResponse {
        val j = get("/plans", auth = false)
        return parsing { PlansResponse.parse(j) }
    }

    // ── services ───────────────────────────────────────────────────────────

    fun startTrial(): TrialResult {
        val j = post("/trial", null, client = slow)
        return parsing { TrialResult.parse(j) }
    }

    fun services(): List<Service> {
        val j = get("/services")
        return parsing { Service.parseList(j) }
    }

    fun service(id: Long): Service {
        val j = get("/services/$id")
        return parsing { Service.parse(j.obj("service") ?: throw ParseException("Missing 'service'")) }
    }

    fun renew(serviceId: Long): RenewResult {
        val j = post("/services/$serviceId/renew", null)
        return parsing { RenewResult.parse(j) }
    }

    fun order(planId: Long): OrderResult {
        val j = post("/orders", JSONObject().put("plan_id", planId), client = slow)
        return parsing { OrderResult.parse(j) }
    }

    // ── invoices ───────────────────────────────────────────────────────────

    fun invoice(id: Long): Invoice {
        val j = get("/invoices/$id")
        return parsing { Invoice.parse(j) }
    }

    fun payUrl(invoiceId: Long): PayUrlResult {
        val j = post("/invoices/$invoiceId/pay-url", null)
        return parsing { PayUrlResult.parse(j) }
    }

    fun redeem(code: String): RedeemResult {
        val j = post("/redeem", JSONObject().put("code", code.trim()))
        return parsing { RedeemResult.parse(j) }
    }

    // ── transport ──────────────────────────────────────────────────────────

    private fun get(path: String, auth: Boolean = true): JSONObject {
        // One retry, GET only, network failure only.
        return try {
            execute(build("GET", path, null, auth), standard)
        } catch (e: BillingError) {
            if (!e.isNetwork) throw e
            sleep(RETRY_DELAY_MS)
            execute(build("GET", path, null, auth), standard)
        }
    }

    private fun post(path: String, body: JSONObject?, auth: Boolean = true, client: OkHttpClient = standard): JSONObject =
        execute(build("POST", path, body ?: JSONObject(), auth), client)

    private fun build(method: String, path: String, body: JSONObject?, auth: Boolean): Request {
        val b = Request.Builder()
            .url(base + path)
            .header("X-SMC-App-Key", appKey)
            .header("X-SMC-Device", deviceId)
            .header("Accept", "application/json")
        if (auth) {
            val token = tokenProvider()
            if (token.isNullOrBlank()) {
                // Do not even ask: the server would answer 401 missing_token and
                // count it against the per-IP bearer-failure limit.
                throw BillingError("missing_token", BillingError.text("missing_token", R.string.billing_sign_in), 401)
            }
            b.header("Authorization", "Bearer $token")
        }
        if (method == "GET") b.get() else b.method(method, (body ?: JSONObject()).toString().toRequestBody(jsonType))
        return b.build()
    }

    private fun execute(request: Request, client: OkHttpClient): JSONObject {
        val response = try {
            client.newCall(request).execute()
        } catch (e: IOException) {
            throw BillingError.network(e)
        }
        response.use { r ->
            val text = try { r.body?.string().orEmpty() } catch (e: IOException) { throw BillingError.network(e) }
            if (!r.isSuccessful) {
                throw BillingError.fromResponse(r.code, text, r.header("Retry-After"))
            }
            val trimmed = text.trim()
            if (!trimmed.startsWith("{")) {
                throw BillingError.badResponse(r.code, if (trimmed.startsWith("<")) "HTML page" else "not JSON")
            }
            val json = try { JSONObject(trimmed) } catch (e: Exception) {
                throw BillingError.badResponse(r.code, "malformed JSON", e)
            }
            return json
        }
    }

    companion object {
        const val STANDARD_TIMEOUT_S = 30L
        const val SLOW_TIMEOUT_S = 60L
        const val RETRY_DELAY_MS = 500L
    }
}

/**
 * Wrap the parse step so a server body that is JSON but not the shape we
 * expect (a missing `id`, `services` not an array) surfaces as bad_response
 * rather than as a raw ParseException from the model layer.
 */
internal inline fun <T> parsing(block: () -> T): T = try {
    block()
} catch (e: ParseException) {
    throw BillingError.badResponse(200, e.message ?: "unexpected shape", e)
} catch (e: org.json.JSONException) {
    throw BillingError.badResponse(200, "unexpected shape", e)
}
