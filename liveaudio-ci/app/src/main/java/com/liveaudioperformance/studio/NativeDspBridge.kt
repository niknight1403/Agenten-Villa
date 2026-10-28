package com.liveaudioperformance.studio

/**
 * JNI bridge for the native live-performance engine.
 *
 * Native playback currently accepts seekable PCM WAV sources. Compressed/unsupported
 * sources automatically remain on the Media3 fallback path in StudioAudioEngine.
 */
object NativeDspBridge {
    const val ENGINE_STATUS = "aaudio-live-v2"

    private val loaded: Boolean = runCatching {
        System.loadLibrary("liveaudio")
        true
    }.getOrDefault(false)

    fun isNativeEngineAvailable(): Boolean =
        loaded && runCatching { nativeProbe() }.getOrDefault(false)

    fun createEngine(sampleRate: Int = 48_000, channelCount: Int = 2): Long {
        if (!loaded) return 0L
        return runCatching { nativeCreateEngine(sampleRate, channelCount) }.getOrDefault(0L)
    }

    fun startEngine(handle: Long): Boolean =
        handle != 0L && runCatching { nativeStartEngine(handle) }.getOrDefault(false)

    fun stopEngine(handle: Long) {
        if (handle != 0L) runCatching { nativeStopEngine(handle) }
    }

    fun destroyEngine(handle: Long) {
        if (handle != 0L) runCatching { nativeDestroyEngine(handle) }
    }

    fun loadDeckWav(handle: Long, deck: Int, fd: Int, offset: Long, length: Long): Boolean =
        handle != 0L && runCatching { nativeLoadDeckWav(handle, deck, fd, offset, length) }.getOrDefault(false)

    fun loadStemWav(handle: Long, deck: Int, stem: Int, fd: Int, offset: Long, length: Long): Boolean =
        handle != 0L && runCatching { nativeLoadStemWav(handle, deck, stem, fd, offset, length) }.getOrDefault(false)

    fun loadPadWav(handle: Long, pad: Int, fd: Int, offset: Long, length: Long): Boolean =
        handle != 0L && runCatching { nativeLoadPadWav(handle, pad, fd, offset, length) }.getOrDefault(false)

    fun playDeck(handle: Long, deck: Int) {
        if (handle != 0L) runCatching { nativePlayDeck(handle, deck) }
    }

    fun pauseDeck(handle: Long, deck: Int) {
        if (handle != 0L) runCatching { nativePauseDeck(handle, deck) }
    }

    fun cueDeck(handle: Long, deck: Int) {
        if (handle != 0L) runCatching { nativeCueDeck(handle, deck) }
    }

    fun setMasterGain(handle: Long, gain: Float) {
        if (handle != 0L) runCatching { nativeSetMasterGain(handle, gain.coerceIn(0f, 1.5f)) }
    }

    fun setCrossfader(handle: Long, value: Float) {
        if (handle != 0L) runCatching { nativeSetCrossfader(handle, value.coerceIn(-1f, 1f)) }
    }

    fun setDeckTempo(handle: Long, deck: Int, ratio: Float) {
        if (handle != 0L) runCatching { nativeSetDeckTempo(handle, deck, ratio.coerceIn(0.5f, 2f)) }
    }

    fun syncDeck(handle: Long, deck: Int, masterDeck: Int, sourceBpm: Float, targetBpm: Float) {
        if (handle != 0L) runCatching { nativeSyncDeck(handle, deck, masterDeck, sourceBpm, targetBpm) }
    }

    fun setStemGain(handle: Long, deck: Int, stem: Int, gain: Float) {
        if (handle != 0L) runCatching { nativeSetStemGain(handle, deck, stem, gain.coerceIn(0f, 1.5f)) }
    }

    fun triggerPad(handle: Long, pad: Int, gain: Float = 1f) {
        if (handle != 0L) runCatching { nativeTriggerPad(handle, pad, gain.coerceIn(0f, 1.5f)) }
    }

    fun triggerFx(handle: Long, mode: Int, amount: Float) {
        if (handle != 0L) runCatching { nativeTriggerFx(handle, mode, amount.coerceIn(0f, 1f)) }
    }

    fun setLimiterEnabled(handle: Long, enabled: Boolean) {
        if (handle != 0L) runCatching { nativeSetLimiterEnabled(handle, enabled) }
    }

    fun setHotCue(handle: Long, deck: Int, slot: Int): Boolean =
        handle != 0L && runCatching { nativeSetHotCue(handle, deck, slot) }.getOrDefault(false)

    fun jumpHotCue(handle: Long, deck: Int, slot: Int): Boolean =
        handle != 0L && runCatching { nativeJumpHotCue(handle, deck, slot) }.getOrDefault(false)

    fun clearHotCue(handle: Long, deck: Int, slot: Int) {
        if (handle != 0L) runCatching { nativeClearHotCue(handle, deck, slot) }
    }

    fun setBeatLoop(handle: Long, deck: Int, beats: Int, bpm: Float): Boolean =
        handle != 0L && runCatching { nativeSetBeatLoop(handle, deck, beats, bpm) }.getOrDefault(false)

    fun clearLoop(handle: Long, deck: Int) {
        if (handle != 0L) runCatching { nativeClearLoop(handle, deck) }
    }

    fun deckPositionSeconds(handle: Long, deck: Int): Double =
        if (handle == 0L) -1.0 else runCatching { nativeDeckPositionSeconds(handle, deck) }.getOrDefault(-1.0)

    fun seekDeckSeconds(handle: Long, deck: Int, seconds: Double): Boolean =
        handle != 0L && runCatching { nativeSeekDeckSeconds(handle, deck, seconds) }.getOrDefault(false)

    fun startRecording(handle: Long, fd: Int): Boolean =
        handle != 0L && runCatching { nativeStartRecording(handle, fd) }.getOrDefault(false)

    fun stopRecording(handle: Long) {
        if (handle != 0L) runCatching { nativeStopRecording(handle) }
    }

    fun recordingStats(handle: Long): FloatArray =
        if (handle == 0L) floatArrayOf(0f, 0f, 0f)
        else runCatching { nativeGetRecordingStats(handle) }.getOrDefault(floatArrayOf(0f, 0f, 0f))

    fun meters(handle: Long): FloatArray =
        if (handle == 0L) floatArrayOf(0f, 0f, 0f, 0f)
        else runCatching { nativeGetMeters(handle) }.getOrDefault(floatArrayOf(0f, 0f, 0f, 0f))

    private external fun nativeProbe(): Boolean
    private external fun nativeCreateEngine(sampleRate: Int, channelCount: Int): Long
    private external fun nativeStartEngine(handle: Long): Boolean
    private external fun nativeStopEngine(handle: Long)
    private external fun nativeDestroyEngine(handle: Long)
    private external fun nativeLoadDeckWav(handle: Long, deck: Int, fd: Int, offset: Long, length: Long): Boolean
    private external fun nativeLoadStemWav(handle: Long, deck: Int, stem: Int, fd: Int, offset: Long, length: Long): Boolean
    private external fun nativeLoadPadWav(handle: Long, pad: Int, fd: Int, offset: Long, length: Long): Boolean
    private external fun nativePlayDeck(handle: Long, deck: Int)
    private external fun nativePauseDeck(handle: Long, deck: Int)
    private external fun nativeCueDeck(handle: Long, deck: Int)
    private external fun nativeSetMasterGain(handle: Long, gain: Float)
    private external fun nativeSetCrossfader(handle: Long, value: Float)
    private external fun nativeSetDeckTempo(handle: Long, deck: Int, ratio: Float)
    private external fun nativeSyncDeck(handle: Long, deck: Int, masterDeck: Int, sourceBpm: Float, targetBpm: Float)
    private external fun nativeSetStemGain(handle: Long, deck: Int, stem: Int, gain: Float)
    private external fun nativeTriggerPad(handle: Long, pad: Int, gain: Float)
    private external fun nativeTriggerFx(handle: Long, mode: Int, amount: Float)
    private external fun nativeSetLimiterEnabled(handle: Long, enabled: Boolean)
    private external fun nativeSetHotCue(handle: Long, deck: Int, slot: Int): Boolean
    private external fun nativeJumpHotCue(handle: Long, deck: Int, slot: Int): Boolean
    private external fun nativeClearHotCue(handle: Long, deck: Int, slot: Int)
    private external fun nativeSetBeatLoop(handle: Long, deck: Int, beats: Int, bpm: Float): Boolean
    private external fun nativeClearLoop(handle: Long, deck: Int)
    private external fun nativeDeckPositionSeconds(handle: Long, deck: Int): Double
    private external fun nativeSeekDeckSeconds(handle: Long, deck: Int, seconds: Double): Boolean
    private external fun nativeStartRecording(handle: Long, fd: Int): Boolean
    private external fun nativeStopRecording(handle: Long)
    private external fun nativeGetRecordingStats(handle: Long): FloatArray
    private external fun nativeGetMeters(handle: Long): FloatArray
}
