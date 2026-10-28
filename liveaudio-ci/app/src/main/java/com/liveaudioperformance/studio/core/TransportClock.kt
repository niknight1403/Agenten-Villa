package com.liveaudioperformance.studio.core

import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.roundToLong

object TransportClock {
    data class Position(
        val bar: Long,
        val beatInBar: Int,
        val absoluteBeat: Double,
        val frame: Long,
    )

    fun framesPerBeat(sampleRate: Int, bpm: Double): Double {
        require(sampleRate > 0)
        require(bpm > 0.0)
        return sampleRate * 60.0 / bpm
    }

    fun beatAtFrame(frame: Long, sampleRate: Int, bpm: Double): Double {
        return max(0L, frame) / framesPerBeat(sampleRate, bpm)
    }

    fun frameAtBeat(beat: Double, sampleRate: Int, bpm: Double): Long {
        return (beat.coerceAtLeast(0.0) * framesPerBeat(sampleRate, bpm)).roundToLong()
    }

    fun quantizeForward(
        frame: Long,
        sampleRate: Int,
        bpm: Double,
        subdivision: Int = 4,
    ): Long {
        require(subdivision > 0)
        val beat = beatAtFrame(frame, sampleRate, bpm)
        val step = 1.0 / subdivision
        val targetBeat = ceil(beat / step) * step
        return frameAtBeat(targetBeat, sampleRate, bpm)
    }

    fun position(
        frame: Long,
        sampleRate: Int,
        bpm: Double,
        beatsPerBar: Int = 4,
    ): Position {
        require(beatsPerBar > 0)
        val beat = beatAtFrame(frame, sampleRate, bpm)
        val beatFloor = beat.toLong()
        return Position(
            bar = beatFloor / beatsPerBar,
            beatInBar = (beatFloor % beatsPerBar).toInt(),
            absoluteBeat = beat,
            frame = max(0L, frame),
        )
    }
}
