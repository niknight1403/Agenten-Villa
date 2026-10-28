package com.liveaudioperformance.studio.core

import kotlin.math.abs

object SetPlanner {
    data class Track(
        val id: String,
        val bpm: Double,
        val camelotNumber: Int?,
        val camelotMode: Char?,
        val energy: Int,
    )

    data class Candidate(
        val track: Track,
        val score: Int,
        val reasons: List<String>,
    )

    fun rankNext(
        current: Track,
        candidates: List<Track>,
        targetEnergy: Int? = null,
    ): List<Candidate> {
        return candidates
            .filter { it.id != current.id }
            .map { candidate -> score(current, candidate, targetEnergy) }
            .sortedWith(compareByDescending<Candidate> { it.score }.thenBy { it.track.id })
    }

    fun score(current: Track, next: Track, targetEnergy: Int? = null): Candidate {
        var score = 100
        val reasons = mutableListOf<String>()

        val bpmDelta = abs(current.bpm - next.bpm)
        val normalizedDelta = minOf(bpmDelta, abs(current.bpm * 2 - next.bpm), abs(current.bpm - next.bpm * 2))
        score -= (normalizedDelta * 2.0).toInt().coerceAtMost(35)
        if (normalizedDelta <= 3.0) reasons += "tempo-close"

        if (isHarmonicallyCompatible(current, next)) {
            score += 10
            reasons += "harmonic-match"
        } else {
            score -= 8
        }

        val desiredEnergy = targetEnergy ?: current.energy
        val energyDelta = abs(desiredEnergy - next.energy)
        score -= (energyDelta / 2).coerceAtMost(25)
        if (energyDelta <= 10) reasons += "energy-fit"

        return Candidate(next, score.coerceIn(0, 100), reasons)
    }

    fun isHarmonicallyCompatible(a: Track, b: Track): Boolean {
        val an = a.camelotNumber ?: return false
        val bn = b.camelotNumber ?: return false
        val am = a.camelotMode ?: return false
        val bm = b.camelotMode ?: return false
        val same = an == bn && am == bm
        val relative = an == bn && am != bm
        val neighbor = am == bm && (abs(an - bn) == 1 || abs(an - bn) == 11)
        return same || relative || neighbor
    }
}
