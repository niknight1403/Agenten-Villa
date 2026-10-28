package com.liveaudioperformance.studio

import java.util.ArrayDeque

class PerformanceEventJournal(private val capacity: Int = 512) {
    data class Event(
        val sequence: Long,
        val timestampMs: Long,
        val type: String,
        val detail: String,
    )

    private val events = ArrayDeque<Event>()
    private var sequence = 0L

    @Synchronized
    fun record(type: String, detail: String, nowMs: Long = System.currentTimeMillis()): Event {
        val event = Event(++sequence, nowMs, type, detail.take(240))
        if (events.size >= capacity.coerceAtLeast(1)) events.removeFirst()
        events.addLast(event)
        return event
    }

    @Synchronized
    fun recent(limit: Int = 50): List<Event> =
        events.toList().takeLast(limit.coerceAtLeast(1))

    @Synchronized
    fun count(): Int = events.size

    @Synchronized
    fun clear() = events.clear()
}
