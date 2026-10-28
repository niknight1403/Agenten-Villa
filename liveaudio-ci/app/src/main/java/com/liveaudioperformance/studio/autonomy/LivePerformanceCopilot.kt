package com.liveaudioperformance.studio.autonomy

import kotlin.math.abs

object LivePerformanceCopilot {
    data class DeckSnapshot(
        val loaded: Boolean,
        val playing: Boolean,
        val bpm: Float,
        val stemsLoaded: Int,
        val vocalStemLoaded: Boolean,
    )

    data class NativeMeters(
        val peakLeft: Float,
        val peakRight: Float,
        val engineRunning: Boolean,
        val xruns: Int,
    ) {
        val peak: Float get() = maxOf(peakLeft, peakRight)
    }

    data class Recommendation(
        val title: String,
        val confidence: Float,
        val autoEligible: Boolean,
        val rationale: String,
    )

    fun recommend(
        deckA: DeckSnapshot,
        deckB: DeckSnapshot,
        meters: NativeMeters,
    ): List<Recommendation> {
        val out = mutableListOf<Recommendation>()

        if (!meters.engineRunning) {
            out += Recommendation(
                title = "Native Engine prüfen",
                confidence = 1f,
                autoEligible = false,
                rationale = "AAudio meldet keinen laufenden Engine-Status.",
            )
        }

        if (meters.xruns > 0) {
            out += Recommendation(
                title = "Performance-Modus SAFE aktivieren",
                confidence = 0.99f,
                autoEligible = true,
                rationale = "Audio-XRuns erkannt: " + meters.xruns + ".",
            )
        }

        if (meters.peak >= 0.98f) {
            out += Recommendation(
                title = "Master um 2 dB absenken",
                confidence = 0.96f,
                autoEligible = true,
                rationale = "Peak liegt nahe 0 dBFS.",
            )
        }

        if (deckA.loaded && deckB.loaded) {
            val bpmDelta = abs(deckA.bpm - deckB.bpm)
            if (bpmDelta <= 8f) {
                out += Recommendation(
                    title = "Decks beat-synchronisieren",
                    confidence = (1f - bpmDelta / 16f).coerceIn(0.55f, 0.98f),
                    autoEligible = true,
                    rationale = "BPM-Abstand ist für Sync geeignet.",
                )
            }
            if (deckA.vocalStemLoaded && deckB.vocalStemLoaded) {
                out += Recommendation(
                    title = "Vocal Clash vermeiden",
                    confidence = 0.92f,
                    autoEligible = true,
                    rationale = "Auf beiden Decks sind Vocal-Stems geladen.",
                )
            }
        }

        val totalStems = deckA.stemsLoaded + deckB.stemsLoaded
        if (totalStems >= 4) {
            out += Recommendation(
                title = "Stem-Mashup vorbereiten",
                confidence = 0.88f,
                autoEligible = false,
                rationale = totalStems.toString() + " Stem-Spuren sind verfügbar.",
            )
        }

        if (out.none { it.title.contains("Sync", ignoreCase = true) } && (deckA.playing || deckB.playing)) {
            out += Recommendation(
                title = "Phrase bis zum nächsten Übergang halten",
                confidence = 0.76f,
                autoEligible = false,
                rationale = "Kein sicherer automatischer Übergang erkannt.",
            )
        }

        return out.sortedByDescending { it.confidence }
    }

    fun meters(raw: FloatArray): NativeMeters = NativeMeters(
        peakLeft = raw.getOrElse(0) { 0f },
        peakRight = raw.getOrElse(1) { 0f },
        engineRunning = raw.getOrElse(2) { 0f } >= 0.5f,
        xruns = raw.getOrElse(3) { 0f }.toInt().coerceAtLeast(0),
    )
}
