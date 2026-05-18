package com.snowmedia

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.appcompat.app.AppCompatActivity

class SplashActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // If SMC is already running (user is returning to it from another app
        // like Plex via the launcher / recents), do NOT re-run the splash and
        // create a fresh MainActivity. That is what was making the app look
        // like it had "closed" — Android was relaunching SplashActivity and
        // tearing down the existing WebView. Just finish and let Android
        // bring the existing task back to the front.
        if (!isTaskRoot) {
            val intent = intent
            val isMainLaunch = intent != null &&
                Intent.ACTION_MAIN == intent.action &&
                (intent.hasCategory(Intent.CATEGORY_LAUNCHER) ||
                    intent.hasCategory(Intent.CATEGORY_LEANBACK_LAUNCHER))
            if (isMainLaunch) {
                finish()
                return
            }
        }

        setContentView(R.layout.activity_splash)

        // Show splash for 2.5 seconds, then open main app
        Handler(Looper.getMainLooper()).postDelayed({
            val intent = Intent(this, MainActivity::class.java)
            startActivity(intent)
            finish()
        }, 2500)
    }
}
