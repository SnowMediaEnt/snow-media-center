package com.snowmedia

import android.os.Bundle
import com.getcapacitor.BridgeActivity
import com.snowmedia.appmanager.AppManagerPlugin

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // Register custom plugins before BridgeActivity initializes the Capacitor bridge.
        registerPlugin(AppManagerPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}