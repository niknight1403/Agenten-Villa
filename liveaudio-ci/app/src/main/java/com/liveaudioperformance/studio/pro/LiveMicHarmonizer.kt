package com.liveaudioperformance.studio.pro

/**
 * Sprint 9: live mic, harmonizer and looper state.
 *
 * Real low-latency mic processing should be implemented in the native DSP core.
 * This class is a compile-safe state and command layer for the UI and controller.
 */
class LiveMicHarmonizer {
    data class State(
        val enabled: Boolean = false,
        val monitoring: Boolean = false,
        val key: String = "A min",
        val pitchCorrection: Float = 0.0f,
        val formantShift: Float = 0.0f,
        val sidechainAmount: Float = 0.0f,
        val harmonies: List<Int> = emptyList(),
        val looperRecording: Boolean = false,
        val looperPlaying: Boolean = false,
    )

    var state: State = State()
        private set

    fun setEnabled(value: Boolean) { state = state.copy(enabled = value) }
    fun setMonitoring(value: Boolean) { state = state.copy(monitoring = value) }
    fun setKey(key: String) { state = state.copy(key = key) }
    fun setPitchCorrection(amount: Float) { state = state.copy(pitchCorrection = amount.coerceIn(0f, 1f)) }
    fun setFormantShift(semitones: Float) { state = state.copy(formantShift = semitones.coerceIn(-12f, 12f)) }
    fun setSidechain(amount: Float) { state = state.copy(sidechainAmount = amount.coerceIn(0f, 1f)) }
    fun setHarmonies(intervals: List<Int>) { state = state.copy(harmonies = intervals) }
    fun toggleLooperRecord() { state = state.copy(looperRecording = !state.looperRecording) }
    fun toggleLooperPlay() { state = state.copy(looperPlaying = !state.looperPlaying) }
}
