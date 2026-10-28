package com.liveaudioperformance.studio

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import java.io.Closeable
import java.util.concurrent.atomic.AtomicInteger

class PerformanceAudioGuard(
    context: Context,
    private val onPauseRequested: () -> Unit,
) : Closeable {
    private val audioManager = context.getSystemService(AudioManager::class.java)
    private val routeRevision = AtomicInteger(0)
    @Volatile private var hasFocus = false

    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        when (change) {
            AudioManager.AUDIOFOCUS_LOSS,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                hasFocus = false
                onPauseRequested()
            }
            AudioManager.AUDIOFOCUS_GAIN -> hasFocus = true
        }
    }

    private val focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
        .setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build()
        )
        .setAcceptsDelayedFocusGain(false)
        .setOnAudioFocusChangeListener(focusListener)
        .build()

    private val deviceCallback = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>) {
            routeRevision.incrementAndGet()
        }

        override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) {
            routeRevision.incrementAndGet()
            onPauseRequested()
        }
    }

    init {
        audioManager?.registerAudioDeviceCallback(deviceCallback, Handler(Looper.getMainLooper()))
    }

    fun requestFocus(): Boolean {
        val result = audioManager?.requestAudioFocus(focusRequest)
            ?: AudioManager.AUDIOFOCUS_REQUEST_FAILED
        hasFocus = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        return hasFocus
    }

    fun snapshot(): Snapshot = Snapshot(
        hasFocus = hasFocus,
        routeRevision = routeRevision.get(),
        outputDeviceCount = audioManager?.getDevices(AudioManager.GET_DEVICES_OUTPUTS)?.size ?: 0,
    )

    override fun close() {
        audioManager?.abandonAudioFocusRequest(focusRequest)
        audioManager?.unregisterAudioDeviceCallback(deviceCallback)
        hasFocus = false
    }

    data class Snapshot(
        val hasFocus: Boolean,
        val routeRevision: Int,
        val outputDeviceCount: Int,
    )
}
