package com.liveaudioperformance.studio

import android.content.Context
import java.io.File

class SessionRecoveryManager(context: Context) {
    private val marker = File(context.filesDir, "live-session-active.marker")

    fun wasUncleanShutdown(): Boolean = marker.exists()

    fun markSessionStarted(nowMs: Long = System.currentTimeMillis()) {
        marker.writeText(nowMs.toString())
    }

    fun markCleanShutdown() {
        marker.delete()
    }

    fun lastStartMs(): Long? = marker.takeIf { it.exists() }?.readText()?.toLongOrNull()
}
