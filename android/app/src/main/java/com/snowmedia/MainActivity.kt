package com.snowmedia

import android.os.Bundle
import com.getcapacitor.BridgeActivity
import com.snowmedia.appmanager.AppManagerPlugin

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // Register custom plugins
        registerPlugin(AppManagerPlugin::class.java)
    }
}