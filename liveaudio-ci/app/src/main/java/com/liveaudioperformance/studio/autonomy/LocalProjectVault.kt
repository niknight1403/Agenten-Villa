package com.liveaudioperformance.studio.autonomy

import java.util.UUID

class LocalProjectVault {
    data class Snapshot(
        val id: String = UUID.randomUUID().toString(),
        val projectId: String,
        val createdAtMs: Long,
        val payload: String,
        val checksum: Int = payload.hashCode(),
    )

    private val snapshots = linkedMapOf<String, MutableList<Snapshot>>()

    @Synchronized
    fun save(projectId: String, payload: String, nowMs: Long): Snapshot {
        require(projectId.isNotBlank())
        val snapshot = Snapshot(projectId = projectId, createdAtMs = nowMs, payload = payload)
        snapshots.getOrPut(projectId) { mutableListOf() }.add(snapshot)
        return snapshot
    }

    @Synchronized
    fun latest(projectId: String): Snapshot? = snapshots[projectId]?.maxByOrNull { it.createdAtMs }

    @Synchronized
    fun history(projectId: String, limit: Int = 20): List<Snapshot> =
        snapshots[projectId].orEmpty().sortedByDescending { it.createdAtMs }.take(limit.coerceAtLeast(1))

    fun validate(snapshot: Snapshot): Boolean = snapshot.payload.hashCode() == snapshot.checksum
}
