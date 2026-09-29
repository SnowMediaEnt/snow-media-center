package com.snowmedia.billing

import com.snowmedia.AppLocale
import com.snowmedia.R
import org.json.JSONObject

/**
 * The one failure type the billing layer throws.
 *
 * Every non-2xx answer, every network failure and every unparseable body ends
 * up here with a stable [code] the web layer can switch on. The codes that
 * come from the server are the ones in docs/API.md; the client adds three of
 * its own for things the server never got to say:
 *
 *   network       — no response at all (DNS, connect, read timeout)
 *   bad_response  — 2xx but the body was not the JSON we expected (an HTML
 *                   error page from a proxy, a truncated body, a missing
 *                   required field)
 *   cancelled     — the caller stopped a poll
 *
 * The messages the client writes itself come from strings.xml in the app's
 * language (AppLocale); the server's own message is passed on as it sent it.
 *
 * [details] is whatever the server put under error.details, kept as-is:
 * `retry_after` on 429, `field` on 422, `order_id`/`service_id` on
 * provisioning_failed.
 */
class BillingError(
    val code: String,
    message: String,
    /** HTTP status, or 0 for a client-side failure. */
    val status: Int = 0,
    val details: JSONObject? = null,
    cause: Throwable? = null,
) : Exception(message, cause) {

    /** The token is no longer good: clear it and show sign-in. */
    val isAuthError: Boolean
        get() = status == 401 && (code == "invalid_token" || code == "token_expired" || code == "missing_token")

    val isNetwork: Boolean get() = code == "network"

    val isRateLimited: Boolean get() = code == "rate_limited"

    /** Seconds the server asked us to wait, when it said. */
    val retryAfterSeconds: Int?
        get() = details?.int("retry_after")

    /** 422 validation_error: which field was wrong. */
    val field: String?
        get() = details?.str("field")

    fun toJson(): JSONObject = JSONObject()
        .put("code", code)
        .put("message", message ?: "")
        .put("status", status)
        .put("details", details ?: JSONObject.NULL)

    companion object {
        /**
         * The text for [id] in the app's language. There is no Context here; AppLocale has the app's
         * (given to it by the first plugin that loads). If it somehow has none yet, the code stands in.
         */
        fun text(code: String, id: Int, vararg args: Any): String =
            AppLocale.stringOrNull(id, *args) ?: code

        fun network(cause: Throwable): BillingError =
            BillingError("network", text("network", R.string.billing_network), 0, null, cause)

        fun badResponse(status: Int, why: String, cause: Throwable? = null): BillingError =
            BillingError("bad_response", text("bad_response", R.string.billing_bad_response, why), status, null, cause)

        fun cancelled(): BillingError = BillingError("cancelled", text("cancelled", R.string.billing_cancelled), 0)

        /**
         * Build from a non-2xx response. The server's `{error:{code,message,details}}`
         * is used when present; anything else (HTML, empty body) becomes
         * `http_<status>` so the caller still gets a stable code.
         */
        fun fromResponse(status: Int, body: String?, retryAfterHeader: String? = null): BillingError {
            val parsed = body?.trim()?.takeIf { it.startsWith("{") }?.let { runCatching { JSONObject(it) }.getOrNull() }
            val err = parsed?.obj("error")
            val code = err?.str("code")?.takeIf { it.isNotBlank() } ?: "http_$status"
            val message = err?.str("message")?.takeIf { it.isNotBlank() } ?: defaultMessage(status)
            var details = err?.obj("details")
            // 429 may carry the wait only as a header. Surface it the same way.
            if (status == 429 && details?.int("retry_after") == null) {
                val secs = retryAfterHeader?.trim()?.toIntOrNull()
                if (secs != null) details = (details ?: JSONObject()).put("retry_after", secs)
            }
            return BillingError(code, message, status, details)
        }

        private fun defaultMessage(status: Int): String = when (status) {
            401 -> text("http_401", R.string.billing_http_401)
            403 -> text("http_403", R.string.billing_http_403)
            404 -> text("http_404", R.string.billing_http_404)
            429 -> text("http_429", R.string.billing_http_429)
            in 500..599 -> text("http_$status", R.string.billing_http_5xx)
            else -> text("http_$status", R.string.billing_request_failed, status)
        }
    }
}
