package com.liveaudioperformance.studio

sealed interface MidiPerformanceAction {
    data class TriggerPad(val index: Int, val velocity: Float) : MidiPerformanceAction
    data class SetCrossfader(val value: Float) : MidiPerformanceAction
    data class SetMaster(val value: Float) : MidiPerformanceAction
    data class TogglePlay(val deck: DeckId) : MidiPerformanceAction
    data class Cue(val deck: DeckId) : MidiPerformanceAction
    data class Sync(val deck: DeckId) : MidiPerformanceAction
    data object BuildFx : MidiPerformanceAction
    data object DropFx : MidiPerformanceAction
}

object MidiPerformanceMapper {
    fun map(status: Int, data1: Int, data2: Int): MidiPerformanceAction? {
        val command = status and 0xF0
        val d1 = data1.coerceIn(0, 127)
        val d2 = data2.coerceIn(0, 127)

        if (command == 0x90 && d2 > 0) {
            return when (d1) {
                in 36..99 -> MidiPerformanceAction.TriggerPad(d1 - 36, d2 / 127f)
                20 -> MidiPerformanceAction.TogglePlay(DeckId.A)
                21 -> MidiPerformanceAction.TogglePlay(DeckId.B)
                22 -> MidiPerformanceAction.Cue(DeckId.A)
                23 -> MidiPerformanceAction.Cue(DeckId.B)
                24 -> MidiPerformanceAction.Sync(DeckId.A)
                25 -> MidiPerformanceAction.Sync(DeckId.B)
                26 -> MidiPerformanceAction.BuildFx
                27 -> MidiPerformanceAction.DropFx
                else -> null
            }
        }

        if (command == 0xB0) {
            return when (d1) {
                1 -> MidiPerformanceAction.SetCrossfader((d2 / 63.5f - 1f).coerceIn(-1f, 1f))
                7 -> MidiPerformanceAction.SetMaster(d2 / 127f)
                else -> null
            }
        }
        return null
    }
}
