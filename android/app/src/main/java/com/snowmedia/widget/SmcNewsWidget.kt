package com.snowmedia.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.util.Log
import android.widget.RemoteViews
import com.snowmedia.R
import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserFactory
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

/**
 * Home-screen widget showing the latest SMC news headlines.
 *
 * NOTE ON PLATFORM SUPPORT: the stock Android TV / Google TV launcher and Fire
 * TV do NOT host app widgets at all. This is for the generic Android boxes
 * (X88/X96 and friends) whose launcher does expose a widget picker. On a device
 * without widget support the receiver simply never fires — it costs nothing and
 * breaks nothing.
 */
class SmcNewsWidget : AppWidgetProvider() {

    companion object {
        private const val TAG = "SmcNewsWidget"
        private const val FEED_URL = "https://snowmediaapps.com/smc/newsfeed.xml"
        private const val PREFS = "smc_news_widget"
        private const val KEY_ITEMS = "cached_items"
        private const val KEY_UPDATED = "cached_updated"
        private const val MAX_ITEMS = 3

        /** Single background thread — widget refreshes are infrequent and serial. */
        private val executor = Executors.newSingleThreadExecutor()
    }

    override fun onUpdate(context: Context, mgr: AppWidgetManager, ids: IntArray) {
        // Paint the cached headlines FIRST so the widget is never blank while the
        // network call is in flight (or if the device is offline entirely).
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val cached = prefs.getString(KEY_ITEMS, null)
            ?.split("\n")
            ?.filter { it.isNotBlank() }
            ?: emptyList()
        val cachedAt = prefs.getString(KEY_UPDATED, "") ?: ""
        for (id in ids) render(context, mgr, id, cached, cachedAt)

        executor.execute {
            val items = try {
                fetchHeadlines()
            } catch (t: Throwable) {
                Log.w(TAG, "feed fetch failed: ${t.message}")
                return@execute // keep showing the cache rather than blanking out
            }
            if (items.isEmpty()) return@execute
            val stamp = SimpleDateFormat("h:mm a", Locale.getDefault()).format(Date())
            prefs.edit()
                .putString(KEY_ITEMS, items.joinToString("\n"))
                .putString(KEY_UPDATED, stamp)
                .apply()
            for (id in ids) render(context, mgr, id, items, stamp)
        }
    }

    private fun render(
        context: Context,
        mgr: AppWidgetManager,
        widgetId: Int,
        items: List<String>,
        updatedAt: String,
    ) {
        val views = RemoteViews(context.packageName, R.layout.smc_news_widget)
        views.setTextViewText(R.id.widget_updated, updatedAt)
        views.setTextViewText(
            R.id.widget_headline_1,
            items.getOrNull(0) ?: "Open Snow Media Center for the latest.",
        )
        views.setTextViewText(R.id.widget_headline_2, items.getOrNull(1) ?: "")
        views.setTextViewText(R.id.widget_headline_3, items.getOrNull(2) ?: "")

        // Tapping anywhere opens the app through its normal launcher entry point.
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            var flags = PendingIntent.FLAG_UPDATE_CURRENT
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                flags = flags or PendingIntent.FLAG_IMMUTABLE
            }
            val pi = PendingIntent.getActivity(context, 0, launch, flags)
            views.setOnClickPendingIntent(R.id.widget_headline_1, pi)
            views.setOnClickPendingIntent(R.id.widget_title, pi)
            views.setOnClickPendingIntent(R.id.widget_icon, pi)
        }
        try {
            mgr.updateAppWidget(widgetId, views)
        } catch (t: Throwable) {
            Log.w(TAG, "updateAppWidget failed: ${t.message}")
        }
    }

    /** Pull <item><title> values out of the RSS feed, newest first. */
    private fun fetchHeadlines(): List<String> {
        val url = URL("$FEED_URL?ts=${System.currentTimeMillis()}")
        val conn = (url.openConnection() as HttpURLConnection).apply {
            connectTimeout = 10000
            readTimeout = 10000
            requestMethod = "GET"
            setRequestProperty("Accept", "application/rss+xml, application/xml, text/xml")
        }
        try {
            if (conn.responseCode !in 200..299) {
                throw IllegalStateException("HTTP ${conn.responseCode}")
            }
            return conn.inputStream.use { parseTitles(it) }
        } finally {
            conn.disconnect()
        }
    }

    private fun parseTitles(stream: InputStream): List<String> {
        val out = ArrayList<String>(MAX_ITEMS)
        val parser = XmlPullParserFactory.newInstance().newPullParser()
        parser.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false)
        parser.setInput(stream, null)

        var insideItem = false
        var event = parser.eventType
        while (event != XmlPullParser.END_DOCUMENT && out.size < MAX_ITEMS) {
            when (event) {
                XmlPullParser.START_TAG -> {
                    val name = parser.name
                    if (name.equals("item", true)) {
                        insideItem = true
                    } else if (insideItem && name.equals("title", true)) {
                        // nextText() consumes through the matching END_TAG.
                        val title = parser.nextText()?.trim().orEmpty()
                        if (title.isNotEmpty()) out.add(title)
                    }
                }
                XmlPullParser.END_TAG -> {
                    if (parser.name.equals("item", true)) insideItem = false
                }
            }
            event = parser.next()
        }
        return out
    }
}