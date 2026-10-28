package com.liveaudioperformance.studio.core

import java.util.UUID

class ProjectSessionStore {
    data class DeckSession(
        val uri: String? = null,
        val bpm: Double = 128.0,
        val cueFrame: Long = 0L,
    )

    data class Session(
        val id: String = UUID.randomUUID().toString(),
        val name: String,
        val updatedAtEpochMs: Long,
        val deckA: DeckSession = DeckSession(),
        val deckB: DeckSession = DeckSession(),
        val crossfader: Float = 0.5f,
        val masterVolume: Float = 0.85f,
        val selectedPadBank: String = "A",
        val tags: Set<String> = emptySet(),
    )

    private val sessions = linkedMapOf<String, Session>()

    @Synchronized
    fun upsert(session: Session) {
        sessions[session.id] = sanitize(session)
    }

    @Synchronized
    fun get(id: String): Session? = sessions[id]

    @Synchronized
    fun delete(id: String): Boolean = sessions.remove(id) != null

    @Synchronized
    fun listNewestFirst(): List<Session> =
        sessions.values.sortedByDescending { it.updatedAtEpochMs }

    @Synchronized
    fun duplicate(id: String, newName: String, nowEpochMs: Long): Session? {
        val source = sessions[id] ?: return null
        return source.copy(
            id = UUID.randomUUID().toString(),
            name = newName.trim().ifBlank { source.name + " Copy" },
            updatedAtEpochMs = nowEpochMs,
        ).also(::upsert)
    }

    private fun sanitize(session: Session): Session = session.copy(
        name = session.name.trim().take(80).ifBlank { "Untitled Set" },
        crossfader = session.crossfader.coerceIn(0f, 1f),
        masterVolume = session.masterVolume.coerceIn(0f, 1f),
        tags = session.tags.map { it.trim().lowercase() }.filter { it.isNotBlank() }.toSet(),
    )
}
