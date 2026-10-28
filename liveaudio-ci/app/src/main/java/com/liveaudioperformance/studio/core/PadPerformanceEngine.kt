package com.liveaudioperformance.studio.core

class PadPerformanceEngine {
    enum class Mode { ONE_SHOT, GATE, LOOP }

    data class PadConfig(
        val sampleId: String,
        val gain: Float = 1f,
        val pitchSemitones: Float = 0f,
        val reverse: Boolean = false,
        val mode: Mode = Mode.ONE_SHOT,
        val chokeGroup: Int? = null,
    )

    data class TriggerResult(
        val startedPad: Int,
        val stoppedPads: List<Int>,
        val effectiveGain: Float,
        val pitchSemitones: Float,
        val reverse: Boolean,
        val mode: Mode,
    )

    private val configs = mutableMapOf<Int, PadConfig>()
    private val active = mutableSetOf<Int>()

    fun assign(index: Int, config: PadConfig) {
        require(index >= 0)
        configs[index] = config
    }

    fun remove(index: Int) {
        configs.remove(index)
        active.remove(index)
    }

    fun trigger(index: Int, velocity: Float = 1f): TriggerResult? {
        val config = configs[index] ?: return null
        val stopped = config.chokeGroup?.let { group ->
            active.filter { activeIndex ->
                activeIndex != index && configs[activeIndex]?.chokeGroup == group
            }
        }.orEmpty()
        active.removeAll(stopped.toSet())
        if (config.mode != Mode.ONE_SHOT) active += index
        return TriggerResult(
            startedPad = index,
            stoppedPads = stopped,
            effectiveGain = (config.gain * velocity.coerceIn(0f, 1f)).coerceIn(0f, 2f),
            pitchSemitones = config.pitchSemitones.coerceIn(-24f, 24f),
            reverse = config.reverse,
            mode = config.mode,
        )
    }

    fun release(index: Int) {
        if (configs[index]?.mode == Mode.GATE) active.remove(index)
    }

    fun stop(index: Int) {
        active.remove(index)
    }

    fun activePads(): Set<Int> = active.toSet()
}
