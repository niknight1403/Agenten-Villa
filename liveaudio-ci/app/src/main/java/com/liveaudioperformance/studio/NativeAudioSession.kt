package com.liveaudioperformance.studio

import android.content.Context
import android.net.Uri

/**
 * Android lifecycle/URI adapter around NativeDspBridge.
 * All file I/O happens during load, never from the real-time audio callback.
 */
class NativeAudioSession(private val context: Context) {
    private val handle: Long = NativeDspBridge.createEngine()
    val available: Boolean = handle != 0L && NativeDspBridge.startEngine(handle)

    private inline fun withSeekableAudio(uri: Uri, block: (fd: Int, offset: Long, length: Long) -> Boolean): Boolean {
        if (!available) return false
        return runCatching {
            context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { afd ->
                block(afd.parcelFileDescriptor.fd, afd.startOffset, afd.length)
            } ?: false
        }.getOrDefault(false)
    }

    fun loadDeck(deck: DeckId, uri: Uri): Boolean =
        withSeekableAudio(uri) { fd, offset, length ->
            NativeDspBridge.loadDeckWav(handle, deck.ordinal, fd, offset, length)
        }

    fun loadStem(deck: DeckId, stem: StemType, uri: Uri): Boolean =
        withSeekableAudio(uri) { fd, offset, length ->
            NativeDspBridge.loadStemWav(handle, deck.ordinal, stem.ordinal, fd, offset, length)
        }

    fun loadPad(index: Int, uri: Uri): Boolean =
        withSeekableAudio(uri) { fd, offset, length ->
            NativeDspBridge.loadPadWav(handle, index, fd, offset, length)
        }

    fun playDeck(deck: DeckId) = NativeDspBridge.playDeck(handle, deck.ordinal)
    fun pauseDeck(deck: DeckId) = NativeDspBridge.pauseDeck(handle, deck.ordinal)
    fun cueDeck(deck: DeckId) = NativeDspBridge.cueDeck(handle, deck.ordinal)

    fun setMix(crossfader: Float, master: Float) {
        NativeDspBridge.setCrossfader(handle, crossfader)
        NativeDspBridge.setMasterGain(handle, master)
    }

    fun setStemGain(deck: DeckId, stem: StemType, gain: Float) =
        NativeDspBridge.setStemGain(handle, deck.ordinal, stem.ordinal, gain)

    fun sync(deck: DeckId, master: DeckId, sourceBpm: Float, targetBpm: Float) =
        NativeDspBridge.syncDeck(handle, deck.ordinal, master.ordinal, sourceBpm, targetBpm)

    fun triggerPad(index: Int, gain: Float = 1f) = NativeDspBridge.triggerPad(handle, index, gain)

    fun buildFx(amount: Float) = NativeDspBridge.triggerFx(handle, 1, amount)
    fun dropFx(amount: Float) = NativeDspBridge.triggerFx(handle, 2, amount)
    fun glitchFx(amount: Float) = NativeDspBridge.triggerFx(handle, 3, amount)
    fun setLimiterEnabled(enabled: Boolean) = NativeDspBridge.setLimiterEnabled(handle, enabled)
    fun setHotCue(deck: DeckId, slot: Int): Boolean =
        NativeDspBridge.setHotCue(handle, deck.ordinal, slot)

    fun jumpHotCue(deck: DeckId, slot: Int): Boolean =
        NativeDspBridge.jumpHotCue(handle, deck.ordinal, slot)

    fun clearHotCue(deck: DeckId, slot: Int) =
        NativeDspBridge.clearHotCue(handle, deck.ordinal, slot)

    fun setBeatLoop(deck: DeckId, beats: Int, bpm: Float): Boolean =
        NativeDspBridge.setBeatLoop(handle, deck.ordinal, beats, bpm)

    fun clearLoop(deck: DeckId) = NativeDspBridge.clearLoop(handle, deck.ordinal)

    fun deckPositionSeconds(deck: DeckId): Double =
        NativeDspBridge.deckPositionSeconds(handle, deck.ordinal)

    fun seekDeckSeconds(deck: DeckId, seconds: Double): Boolean =
        NativeDspBridge.seekDeckSeconds(handle, deck.ordinal, seconds)

    fun startRecording(uri: Uri): Boolean =
        if (!available) false else runCatching {
            context.contentResolver.openFileDescriptor(uri, "rw")?.use { pfd ->
                NativeDspBridge.startRecording(handle, pfd.fd)
            } ?: false
        }.getOrDefault(false)

    fun stopRecording() = NativeDspBridge.stopRecording(handle)
    fun recordingStats(): FloatArray = NativeDspBridge.recordingStats(handle)

    fun meters(): FloatArray = NativeDspBridge.meters(handle)

    fun release() {
        stopRecording()
        if (handle != 0L) {
            NativeDspBridge.stopEngine(handle)
            NativeDspBridge.destroyEngine(handle)
        }
    }
}
