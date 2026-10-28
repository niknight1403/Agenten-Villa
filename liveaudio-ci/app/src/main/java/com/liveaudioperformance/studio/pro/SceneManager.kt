package com.liveaudioperformance.studio.pro

import java.util.UUID

/** Sprint 8: scene snapshots for live performance. */
class SceneManager {
    data class StemSnapshot(
        val deck: String,
        val stem: String,
        val volume: Float,
        val muted: Boolean,
        val solo: Boolean,
    )

    data class FxSnapshot(
        val filter: Float,
        val delay: Float,
        val reverb: Float,
        val glitch: Float,
        val activeMacro: String,
    )

    data class SceneSnapshot(
        val id: String = UUID.randomUUID().toString(),
        val name: String,
        val deckAPositionMs: Long,
        val deckBPositionMs: Long,
        val crossfader: Float,
        val masterVolume: Float,
        val selectedPadBank: String,
        val stems: List<StemSnapshot>,
        val fx: FxSnapshot,
        val padAssignments: Map<Int, String>,
    )

    private val scenes = linkedMapOf<String, SceneSnapshot>()

    fun save(scene: SceneSnapshot) {
        scenes[scene.id] = scene
    }

    fun rename(id: String, name: String) {
        scenes[id]?.let { scenes[id] = it.copy(name = name) }
    }

    fun delete(id: String) {
        scenes.remove(id)
    }

    fun get(id: String): SceneSnapshot? = scenes[id]

    fun list(): List<SceneSnapshot> = scenes.values.toList()

    fun nextSlotName(): String = "Scene ${(scenes.size + 1).toString().padStart(2, '0')}"
}
