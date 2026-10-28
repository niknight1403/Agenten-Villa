package com.liveaudioperformance.studio.core

import java.util.PriorityQueue
import java.util.concurrent.atomic.AtomicLong

class PerformanceScheduler {
    data class Command(
        val id: Long,
        val frame: Long,
        val type: String,
        val payload: String? = null,
    )

    private val ids = AtomicLong(0)
    private val queue = PriorityQueue<Command>(compareBy<Command> { it.frame }.thenBy { it.id })

    @Synchronized
    fun schedule(frame: Long, type: String, payload: String? = null): Command {
        val command = Command(
            id = ids.incrementAndGet(),
            frame = frame.coerceAtLeast(0L),
            type = type,
            payload = payload,
        )
        queue += command
        return command
    }

    @Synchronized
    fun drainReady(currentFrame: Long): List<Command> {
        val ready = mutableListOf<Command>()
        while (queue.peek()?.frame?.let { it <= currentFrame } == true) {
            ready += queue.remove()
        }
        return ready
    }

    @Synchronized
    fun cancel(id: Long): Boolean = queue.removeIf { it.id == id }

    @Synchronized
    fun clear() = queue.clear()

    @Synchronized
    fun pendingCount(): Int = queue.size
}
