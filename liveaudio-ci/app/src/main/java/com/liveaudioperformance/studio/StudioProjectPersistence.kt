package com.liveaudioperformance.studio

import android.content.Context
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

class StudioProjectPersistence(context: Context) {
    private val file = File(context.filesDir, "live-performance-project.json")

    @Synchronized
    fun save(state: StudioState) {
        val json = JSONObject()
            .put("version", 1)
            .put("crossfader", state.crossfader)
            .put("masterVolume", state.masterVolume)
            .put("selectedBank", state.selectedBank.name)
            .put("quantizePads", state.quantizePads)
            .put("deckA", deckJson(state.deckA))
            .put("deckB", deckJson(state.deckB))
            .put("pads", JSONArray().apply {
                state.pads.forEach { pad ->
                    put(JSONObject()
                        .put("index", pad.index)
                        .put("bank", pad.bank.name)
                        .put("uri", pad.uri?.toString())
                        .put("label", pad.label)
                        .put("category", pad.category?.name))
                }
            })

        val temp = File(file.parentFile, file.name + ".tmp")
        temp.writeText(json.toString())
        if (!temp.renameTo(file)) {
            file.writeText(json.toString())
            temp.delete()
        }
    }

    @Synchronized
    fun load(): StudioState? = runCatching {
        if (!file.exists()) return null
        val json = JSONObject(file.readText())
        val base = StudioState()
        base.copy(
            deckA = parseDeck(json.optJSONObject("deckA"), DeckId.A),
            deckB = parseDeck(json.optJSONObject("deckB"), DeckId.B),
            crossfader = json.optDouble("crossfader", base.crossfader.toDouble()).toFloat().coerceIn(-1f, 1f),
            masterVolume = json.optDouble("masterVolume", base.masterVolume.toDouble()).toFloat().coerceIn(0f, 1f),
            selectedBank = runCatching { PadBank.valueOf(json.optString("selectedBank", base.selectedBank.name)) }.getOrDefault(base.selectedBank),
            quantizePads = json.optBoolean("quantizePads", base.quantizePads),
            pads = parsePads(json.optJSONArray("pads"), base.pads),
        )
    }.getOrNull()

    private fun deckJson(deck: DeckState): JSONObject = JSONObject()
        .put("uri", deck.uri?.toString())
        .put("title", deck.title)
        .put("bpm", deck.bpm)
        .put("key", deck.key)
        .put("hotCues", JSONArray(deck.hotCuesSeconds.map { it ?: JSONObject.NULL }))
        .put("loopBeats", deck.loopBeats)
        .put("stems", JSONArray().apply {
            deck.stems.forEach { stem ->
                put(JSONObject()
                    .put("type", stem.type.name)
                    .put("uri", stem.uri?.toString())
                    .put("volume", stem.volume)
                    .put("muted", stem.muted)
                    .put("solo", stem.solo))
            }
        })

    private fun parseDeck(json: JSONObject?, id: DeckId): DeckState {
        if (json == null) return DeckState(id)
        val base = DeckState(id)
        val stemsJson = json.optJSONArray("stems")
        val stems = StemType.entries.map { type ->
            val item = (0 until (stemsJson?.length() ?: 0))
                .mapNotNull { stemsJson?.optJSONObject(it) }
                .firstOrNull { it.optString("type") == type.name }
            StemChannelState(
                type = type,
                uri = item?.optString("uri")?.takeIf { it.isNotBlank() && it != "null" }?.let(Uri::parse),
                volume = item?.optDouble("volume", 1.0)?.toFloat()?.coerceIn(0f, 1f) ?: 1f,
                muted = item?.optBoolean("muted", false) ?: false,
                solo = item?.optBoolean("solo", false) ?: false,
            )
        }
        val cueJson = json.optJSONArray("hotCues")
        val cues = List(8) { index ->
            cueJson?.takeIf { index < it.length() && !it.isNull(index) }?.optDouble(index)?.takeIf { it >= 0.0 }
        }
        return base.copy(
            uri = json.optString("uri").takeIf { it.isNotBlank() && it != "null" }?.let(Uri::parse),
            title = json.optString("title", base.title),
            bpm = json.optDouble("bpm", base.bpm.toDouble()).toFloat().coerceIn(60f, 220f),
            key = json.optString("key", base.key),
            stems = stems,
            hotCuesSeconds = cues,
            loopBeats = json.optInt("loopBeats", 0).coerceAtLeast(0),
        )
    }

    private fun parsePads(json: JSONArray?, fallback: List<PadState>): List<PadState> {
        if (json == null) return fallback
        val result = fallback.toMutableList()
        for (i in 0 until json.length()) {
            val item = json.optJSONObject(i) ?: continue
            val bank = runCatching { PadBank.valueOf(item.optString("bank")) }.getOrNull() ?: continue
            val localIndex = item.optInt("index", -1)
            if (localIndex !in 0..15) continue
            val global = bank.ordinal * 16 + localIndex
            result[global] = result[global].copy(
                uri = item.optString("uri").takeIf { it.isNotBlank() && it != "null" }?.let(Uri::parse),
                label = item.optString("label", result[global].label),
                category = item.optString("category").takeIf { it.isNotBlank() && it != "null" }
                    ?.let { runCatching { StemType.valueOf(it) }.getOrNull() },
            )
        }
        return result
    }
}
