package com.liveaudioperformance.studio

import android.content.Context
import android.media.midi.MidiDevice
import android.media.midi.MidiDeviceInfo
import android.media.midi.MidiManager
import android.media.midi.MidiOutputPort
import android.media.midi.MidiReceiver
import android.os.Handler
import android.os.Looper
import java.io.Closeable

class MidiControllerBridge(
    context: Context,
    private val onAction: (MidiPerformanceAction) -> Unit,
) : MidiReceiver(), Closeable {
    private val manager = context.getSystemService(MidiManager::class.java)
    private val handler = Handler(Looper.getMainLooper())
    private val devices = mutableListOf<MidiDevice>()
    private val outputPorts = mutableListOf<MidiOutputPort>()
    private var started = false

    private val callback = object : MidiManager.DeviceCallback() {
        override fun onDeviceAdded(info: MidiDeviceInfo) = openDevice(info)
        override fun onDeviceRemoved(info: MidiDeviceInfo) = Unit
    }

    fun start() {
        if (started || manager == null) return
        started = true
        manager.registerDeviceCallback(callback, handler)
        manager.devices.forEach(::openDevice)
    }

    private fun openDevice(info: MidiDeviceInfo) {
        manager?.openDevice(info, deviceOpened@{ device ->
            if (device == null || devices.any { it.info.id == device.info.id }) {
                device?.close()
                return@deviceOpened
            }
            devices += device
            repeat(info.outputPortCount) { portNumber ->
                device.openOutputPort(portNumber)?.also { port ->
                    port.connect(this)
                    outputPorts += port
                }
            }
        }, handler)
    }

    override fun onSend(data: ByteArray, offset: Int, count: Int, timestamp: Long) {
        var cursor = offset
        val end = (offset + count).coerceAtMost(data.size)
        while (cursor < end) {
            val status = data[cursor].toInt() and 0xFF
            val command = status and 0xF0
            val length = if (command == 0xC0 || command == 0xD0) 2 else 3
            if (cursor + length > end) break
            val data1 = data[cursor + 1].toInt() and 0x7F
            val data2 = if (length == 3) data[cursor + 2].toInt() and 0x7F else 0
            MidiPerformanceMapper.map(status, data1, data2)?.let(onAction)
            cursor += length
        }
    }

    override fun close() {
        if (!started) return
        started = false
        manager?.unregisterDeviceCallback(callback)
        outputPorts.forEach { runCatching { it.close() } }
        devices.forEach { runCatching { it.close() } }
        outputPorts.clear()
        devices.clear()
    }
}
