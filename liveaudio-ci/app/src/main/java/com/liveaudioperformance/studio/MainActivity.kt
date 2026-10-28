package com.liveaudioperformance.studio

import com.liveaudioperformance.studio.autonomy.AiAutomationPlanner
import com.liveaudioperformance.studio.autonomy.LivePerformanceCopilot
import com.liveaudioperformance.studio.autonomy.LiveTelemetryDashboard
import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { StudioRoot() }
    }
}

private val AppColors = darkColorScheme(
    background = Color(0xFF05070D),
    surface = Color(0xFF0D111A),
    primary = Color(0xFF8E5CFF),
    secondary = Color(0xFF00D5FF),
    tertiary = Color(0xFFFF4F7B),
    onBackground = Color(0xFFE8ECF8),
    onSurface = Color(0xFFE8ECF8),
    onPrimary = Color.White,
    onSecondary = Color.Black,
)

@Composable
fun StudioRoot() {
    MaterialTheme(colorScheme = AppColors) {
        Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            StudioApp()
        }
    }
}

@Composable
fun StudioApp() {
    val context = LocalContext.current
    val controller = remember { StudioController(context.applicationContext) }
    DisposableEffect(Unit) {
        onDispose { controller.release() }
    }

    var importTargetDeck by remember { mutableStateOf<DeckId?>(null) }
    var importTargetStem by remember { mutableStateOf<Pair<DeckId, StemType>?>(null) }
    var importTargetPad by remember { mutableStateOf<Int?>(null) }
    var selectedTab by remember { mutableStateOf(StudioTab.Decks) }

    val deckImportLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        val deck = importTargetDeck
        if (deck != null && uri != null) {
            context.persistReadPermission(uri)
            controller.loadDeck(deck, uri)
        }
    }

    val stemImportLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        val target = importTargetStem
        if (target != null && uri != null) {
            context.persistReadPermission(uri)
            controller.loadStem(target.first, target.second, uri)
        }
    }

    val padImportLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        val target = importTargetPad
        if (target != null && uri != null) {
            context.persistReadPermission(uri)
            controller.assignPad(target, uri)
        }
    }

    val recordingLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("audio/wav")
    ) { uri ->
        if (uri != null) controller.startRecording(uri)
    }

    val state = controller.state

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(Color(0xFF05070D), Color(0xFF090D18), Color(0xFF05070D))
                )
            )
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        TopBar(state)
        TabBar(selectedTab) { selectedTab = it }

        when (selectedTab) {
            StudioTab.Decks -> DecksScreen(
                state = state,
                onImportDeck = {
                    importTargetDeck = it
                    deckImportLauncher.launch(arrayOf("audio/*"))
                },
                onPlayPause = controller::togglePlay,
                onCue = controller::cue,
                onSync = controller::syncDeckToMaster,
                onSetHotCue = controller::setHotCue,
                onJumpHotCue = controller::jumpHotCue,
                onLoop = controller::toggleFourBeatLoop,
                onCrossfader = controller::setCrossfader,
                onMasterVolume = controller::setMasterVolume,
                onBpm = controller::setBpm,
            )

            StudioTab.Stems -> StemsScreen(
                state = state,
                onImportStem = { deck, stem ->
                    importTargetStem = deck to stem
                    stemImportLauncher.launch(arrayOf("audio/*"))
                },
                onVolume = controller::setStemVolume,
                onMute = controller::toggleStemMute,
                onSolo = controller::toggleStemSolo,
                onPlayPause = controller::togglePlay,
            )

            StudioTab.Pads -> PadsScreen(
                state = state,
                onSelectBank = controller::selectPadBank,
                onAssignPad = { padIndex ->
                    importTargetPad = padIndex
                    padImportLauncher.launch(arrayOf("audio/*"))
                },
                onTriggerPad = controller::triggerPad,
                onQuantize = controller::setQuantizePads,
            )

            StudioTab.Fx -> FxScreen(
                state = state,
                onBuild = controller::triggerBuildFx,
                onDrop = controller::triggerDropFx,
                onGlitch = controller::triggerGlitchFx,
                onMacro = controller::setFxMacro,
                onLimiter = controller::setLimiterEnabled,
                onStartRecording = { recordingLauncher.launch("LivePerformance.wav") },
                onStopRecording = controller::stopRecording,
            )

            StudioTab.Ai -> AiScreen(
                state = state,
                onAnalyze = controller::analyzeCurrentSet,
                onAutoMap = controller::autoMapPads,
                onAcceptSuggestion = controller::acceptSuggestion,
                onAutopilot = controller::setAutopilotEnabled,
            )
        }
    }
}

private fun Context.persistReadPermission(uri: Uri) {
    runCatching {
        contentResolver.takePersistableUriPermission(
            uri,
            android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION
        )
    }
}

enum class StudioTab(val label: String) { Decks("Decks"), Stems("Stems"), Pads("Pads"), Fx("FX"), Ai("AI") }
enum class DeckId(val label: String) { A("Deck A"), B("Deck B") }
enum class StemType(val label: String) { DRUMS("Drums"), BASS("Bass"), VOCALS("Vocals"), OTHER("Other") }
enum class PadBank { A, B, C, D }

data class DeckState(
    val id: DeckId,
    val uri: Uri? = null,
    val title: String = "Kein Song geladen",
    val isPlaying: Boolean = false,
    val bpm: Float = 128f,
    val key: String = "F#m",
    val stems: List<StemChannelState> = StemType.entries.map { StemChannelState(it) },
    val hotCuesSeconds: List<Double?> = List(8) { null },
    val loopBeats: Int = 0,
)

data class StemChannelState(
    val type: StemType,
    val uri: Uri? = null,
    val volume: Float = 1f,
    val muted: Boolean = false,
    val solo: Boolean = false,
)

data class PadState(
    val index: Int,
    val bank: PadBank,
    val uri: Uri? = null,
    val label: String = "Pad ${index + 1}",
    val category: StemType? = null,
)

data class FxState(
    val macroAmount: Float = 0.35f,
    val limiterEnabled: Boolean = true,
    val activeMacro: String = "Idle",
)

data class AiState(
    val analysis: SongAnalysis? = null,
    val suggestions: List<String> = emptyList(),
    val lastAccepted: String? = null,
    val autopilotEnabled: Boolean = false,
    val healthHeadline: String = "Telemetry pending",
)

data class SongAnalysis(
    val bpm: Float,
    val key: String,
    val energy: Int,
    val bestLoopPoint: String,
    val stemReadiness: String,
)

data class StudioState(
    val deckA: DeckState = DeckState(DeckId.A),
    val deckB: DeckState = DeckState(DeckId.B),
    val crossfader: Float = 0f,
    val masterVolume: Float = 0.85f,
    val selectedBank: PadBank = PadBank.A,
    val quantizePads: Boolean = true,
    val pads: List<PadState> = PadBank.entries.flatMap { bank ->
        List(16) { index -> PadState(index = index, bank = bank) }
    },
    val fx: FxState = FxState(),
    val ai: AiState = AiState(),
    val recording: Boolean = false,
    val recordingStatus: String = "REC bereit",
    val recoveredSession: Boolean = false,
)

class StudioController(private val appContext: Context) {
    private val persistence = StudioProjectPersistence(appContext)
    private val recovery = SessionRecoveryManager(appContext)
    private val journal = PerformanceEventJournal()
    private val audio = StudioAudioEngine(appContext)
    private val hadUncleanShutdown = recovery.wasUncleanShutdown()

    var state by mutableStateOf(
        (persistence.load() ?: StudioState()).copy(recoveredSession = hadUncleanShutdown)
    )
        private set

    private val midi = MidiControllerBridge(appContext, ::handleMidi)

    init {
        restoreAudioState()
        midi.start()
        recovery.markSessionStarted()
        if (hadUncleanShutdown) {
            state = state.copy(
                ai = state.ai.copy(
                    suggestions = listOf("Vorherige Session wurde nach unsauberem Ende wiederhergestellt.") + state.ai.suggestions
                )
            )
        }
        persistAndLog("session.start", if (hadUncleanShutdown) "recovered" else "clean")
    }

    private fun restoreAudioState() {
        state.deckA.uri?.let { audio.loadDeck(DeckId.A, it) }
        state.deckB.uri?.let { audio.loadDeck(DeckId.B, it) }
        listOf(state.deckA, state.deckB).forEach { deck ->
            deck.stems.forEach { stem ->
                stem.uri?.let { audio.loadStem(deck.id, stem.type, it) }
            }
        }
        state.pads.forEachIndexed { index, pad ->
            pad.uri?.let { audio.assignPad(index, it) }
        }
        audio.setMix(state.crossfader, state.masterVolume, state)
        audio.setLimiterEnabled(state.fx.limiterEnabled)
    }

    private fun persistAndLog(type: String, detail: String) {
        persistence.save(state)
        journal.record(type, detail)
    }

    fun loadDeck(deck: DeckId, uri: Uri) {
        audio.loadDeck(deck, uri)
        state = state.updateDeck(deck) {
            it.copy(
                uri = uri,
                title = uri.lastPathSegment?.substringAfterLast('/')?.takeLast(36) ?: "Importierter Song",
                isPlaying = false,
                hotCuesSeconds = List(8) { null },
                loopBeats = 0,
            )
        }
        persistAndLog("deck.load", deck.name)
        analyzeCurrentSet()
    }

    fun loadStem(deck: DeckId, stem: StemType, uri: Uri) {
        audio.loadStem(deck, stem, uri)
        state = state.updateDeck(deck) { deckState ->
            deckState.copy(stems = deckState.stems.map {
                if (it.type == stem) it.copy(uri = uri) else it
            })
        }
        persistAndLog("stem.load", deck.name + ":" + stem.name)
    }

    fun togglePlay(deck: DeckId) {
        val deckState = state.deck(deck)
        if (deckState.isPlaying) audio.pauseDeck(deck) else audio.playDeck(deck)
        state = state.updateDeck(deck) { it.copy(isPlaying = !it.isPlaying) }
        persistAndLog("deck.play", deck.name + ":" + state.deck(deck).isPlaying)
    }

    fun cue(deck: DeckId) {
        audio.cue(deck)
        state = state.updateDeck(deck) { it.copy(isPlaying = false) }
        persistAndLog("deck.cue", deck.name)
    }

    fun syncDeckToMaster(deck: DeckId) {
        val current = state.deck(deck)
        val masterDeck = if (deck == DeckId.A) DeckId.B else DeckId.A
        val master = state.deck(masterDeck)
        audio.syncDeck(deck, masterDeck, current.bpm, master.bpm)
        state = state.updateDeck(deck) { it.copy(bpm = master.bpm, key = master.key) }
        persistAndLog("deck.sync", deck.name + "->" + masterDeck.name)
    }

    fun setHotCue(deck: DeckId, slot: Int) {
        if (slot !in 0..7) return
        val seconds = audio.setHotCue(deck, slot) ?: return
        state = state.updateDeck(deck) { current ->
            current.copy(hotCuesSeconds = current.hotCuesSeconds.toMutableList().also { it[slot] = seconds })
        }
        persistAndLog("hotcue.set", deck.name + ":" + slot)
    }

    fun jumpHotCue(deck: DeckId, slot: Int) {
        val seconds = state.deck(deck).hotCuesSeconds.getOrNull(slot) ?: return
        audio.jumpHotCue(deck, slot, seconds)
        journal.record("hotcue.jump", deck.name + ":" + slot)
    }

    fun toggleFourBeatLoop(deck: DeckId) {
        val current = state.deck(deck)
        if (current.loopBeats > 0) {
            audio.clearLoop(deck)
            state = state.updateDeck(deck) { it.copy(loopBeats = 0) }
            persistAndLog("loop.clear", deck.name)
        } else if (audio.setBeatLoop(deck, 4, current.bpm)) {
            state = state.updateDeck(deck) { it.copy(loopBeats = 4) }
            persistAndLog("loop.set", deck.name + ":4")
        }
    }

    fun setCrossfader(value: Float) {
        val safe = value.coerceIn(-1f, 1f)
        state = state.copy(crossfader = safe)
        audio.setMix(crossfader = safe, masterVolume = state.masterVolume, state = state)
        persistAndLog("mixer.crossfader", safe.toString())
    }

    fun setMasterVolume(value: Float) {
        val safe = value.coerceIn(0f, 1f)
        state = state.copy(masterVolume = safe)
        audio.setMix(crossfader = state.crossfader, masterVolume = safe, state = state)
        persistAndLog("mixer.master", safe.toString())
    }

    fun setBpm(deck: DeckId, bpm: Float) {
        state = state.updateDeck(deck) { it.copy(bpm = bpm.coerceIn(60f, 220f)) }
        persistAndLog("deck.bpm", deck.name + ":" + bpm)
    }

    fun setStemVolume(deck: DeckId, stem: StemType, volume: Float) {
        state = state.updateStem(deck, stem) { it.copy(volume = volume.coerceIn(0f, 1f)) }
        audio.setMix(state.crossfader, state.masterVolume, state)
        persistAndLog("stem.volume", deck.name + ":" + stem.name)
    }

    fun toggleStemMute(deck: DeckId, stem: StemType) {
        state = state.updateStem(deck, stem) { it.copy(muted = !it.muted) }
        audio.setMix(state.crossfader, state.masterVolume, state)
        persistAndLog("stem.mute", deck.name + ":" + stem.name)
    }

    fun toggleStemSolo(deck: DeckId, stem: StemType) {
        state = state.updateStem(deck, stem) { it.copy(solo = !it.solo) }
        audio.setMix(state.crossfader, state.masterVolume, state)
        persistAndLog("stem.solo", deck.name + ":" + stem.name)
    }

    fun selectPadBank(bank: PadBank) {
        state = state.copy(selectedBank = bank)
        persistAndLog("pad.bank", bank.name)
    }

    fun assignPad(globalIndex: Int, uri: Uri) {
        state = state.copy(pads = state.pads.mapIndexed { index, pad ->
            if (index == globalIndex) pad.copy(
                uri = uri,
                label = uri.lastPathSegment?.substringAfterLast('/')?.takeLast(16) ?: "Sample " + (pad.index + 1)
            ) else pad
        })
        audio.assignPad(globalIndex, uri)
        persistAndLog("pad.assign", globalIndex.toString())
    }

    fun triggerPad(globalIndex: Int) = triggerPad(globalIndex, 1f)

    private fun triggerPad(globalIndex: Int, velocity: Float) {
        val bpm = ((state.deckA.bpm + state.deckB.bpm) / 2f).coerceIn(60f, 220f)
        audio.triggerPad(globalIndex, quantize = state.quantizePads, bpm = bpm, gain = velocity)
        journal.record("pad.trigger", globalIndex.toString())
    }

    fun setQuantizePads(value: Boolean) {
        state = state.copy(quantizePads = value)
        persistAndLog("pad.quantize", value.toString())
    }

    fun setFxMacro(value: Float) {
        state = state.copy(fx = state.fx.copy(macroAmount = value.coerceIn(0f, 1f)))
        persistence.save(state)
    }

    fun setLimiterEnabled(value: Boolean) {
        state = state.copy(fx = state.fx.copy(limiterEnabled = value))
        audio.setLimiterEnabled(value)
        persistAndLog("fx.limiter", value.toString())
    }

    fun triggerBuildFx() {
        state = state.copy(fx = state.fx.copy(activeMacro = "Build"))
        audio.buildFx(state.fx.macroAmount, state)
        persistAndLog("fx.build", state.fx.macroAmount.toString())
    }

    fun triggerDropFx() {
        state = state.copy(fx = state.fx.copy(activeMacro = "Drop"))
        audio.dropFx(state.fx.macroAmount, state)
        persistAndLog("fx.drop", state.fx.macroAmount.toString())
    }

    fun triggerGlitchFx() {
        state = state.copy(fx = state.fx.copy(activeMacro = "Glitch"))
        audio.glitchFx(state.fx.macroAmount, state)
        persistAndLog("fx.glitch", state.fx.macroAmount.toString())
    }

    fun startRecording(uri: Uri) {
        val started = audio.startRecording(uri)
        state = state.copy(
            recording = started,
            recordingStatus = if (started) "REC läuft · Native Master WAV" else "REC nicht verfügbar",
        )
        persistAndLog("recording.start", started.toString())
    }

    fun stopRecording() {
        val stats = audio.stopRecording()
        state = state.copy(
            recording = false,
            recordingStatus = "REC gespeichert · Frames: " + stats.recordedFrames + " · Drops: " + stats.droppedFrames,
        )
        persistAndLog("recording.stop", "drops=" + stats.droppedFrames)
    }

    fun setAutopilotEnabled(enabled: Boolean) {
        state = state.copy(ai = state.ai.copy(autopilotEnabled = enabled))
        persistAndLog("ai.autopilot", enabled.toString())
    }

    fun analyzeCurrentSet() {
        val loadedStemsA = state.deckA.stems.count { it.uri != null }
        val loadedStemsB = state.deckB.stems.count { it.uri != null }
        val meters = LivePerformanceCopilot.meters(audio.nativeMeters())
        val recommendations = LivePerformanceCopilot.recommend(
            deckA = LivePerformanceCopilot.DeckSnapshot(
                loaded = state.deckA.uri != null,
                playing = state.deckA.isPlaying,
                bpm = state.deckA.bpm,
                stemsLoaded = loadedStemsA,
                vocalStemLoaded = state.deckA.stems.any { it.type == StemType.VOCALS && it.uri != null },
            ),
            deckB = LivePerformanceCopilot.DeckSnapshot(
                loaded = state.deckB.uri != null,
                playing = state.deckB.isPlaying,
                bpm = state.deckB.bpm,
                stemsLoaded = loadedStemsB,
                vocalStemLoaded = state.deckB.stems.any { it.type == StemType.VOCALS && it.uri != null },
            ),
            meters = meters,
        )

        val telemetry = audio.telemetrySnapshot(journal.count())
        val summary = LiveTelemetryDashboard.summarize(telemetry)
        val plan = AiAutomationPlanner.plan(
            candidates = AiAutomationPlanner.fromCopilot(recommendations),
            policy = AiAutomationPlanner.Policy(
                enabled = state.ai.autopilotEnabled,
                allowMediumRisk = false,
                maxCommandsPerPhrase = 2,
            ),
            alreadyExecuted = 0,
        )

        plan.automatic.forEach(::executeAutomation)

        val loadedBpms = listOfNotNull(
            state.deckA.takeIf { it.uri != null }?.bpm,
            state.deckB.takeIf { it.uri != null }?.bpm,
        )
        val avgBpm = loadedBpms.ifEmpty { listOf(128f) }.average().toFloat()
        val suggestions = recommendations.map {
            it.title + " — " + it.rationale
        }.ifEmpty {
            listOf("Tracks laden und Wiedergabe starten, um Live-Empfehlungen zu erzeugen.")
        }

        state = state.copy(
            ai = state.ai.copy(
                analysis = SongAnalysis(
                    bpm = avgBpm,
                    key = state.deckA.key,
                    energy = (meters.peak * 100f).roundToInt().coerceIn(0, 100),
                    bestLoopPoint = if (state.deckA.isPlaying || state.deckB.isPlaying) "Nächste 8/16-Takt-Phrase" else "Wiedergabe starten",
                    stemReadiness = (loadedStemsA + loadedStemsB).toString() + " / 8 Stem-Dateien geladen",
                ),
                suggestions = suggestions,
                healthHeadline = summary.headline + if (summary.issues.isEmpty()) "" else " · " + summary.issues.joinToString(),
            )
        )
        persistAndLog("ai.analyze", summary.health.name)
    }

    private fun executeAutomation(candidate: AiAutomationPlanner.Candidate) {
        when (candidate.command) {
            AiAutomationPlanner.Command.LOWER_MASTER ->
                setMasterVolume((state.masterVolume - 0.1f).coerceAtLeast(0.45f))
            AiAutomationPlanner.Command.SAFE_MODE ->
                setMasterVolume(state.masterVolume.coerceAtMost(0.75f))
            AiAutomationPlanner.Command.SYNC_DECKS ->
                if (state.deckA.uri != null && state.deckB.uri != null) syncDeckToMaster(DeckId.B)
            AiAutomationPlanner.Command.BUILD_FX -> triggerBuildFx()
            AiAutomationPlanner.Command.DROP_FX -> triggerDropFx()
            AiAutomationPlanner.Command.HOLD -> Unit
        }
        journal.record("ai.execute", candidate.command.name)
    }

    fun autoMapPads() {
        val selectedDeck = if (state.deckA.stems.any { it.uri != null }) state.deckA else state.deckB
        val stems = selectedDeck.stems.filter { it.uri != null }
        if (stems.isEmpty()) {
            state = state.copy(ai = state.ai.copy(
                suggestions = listOf("Noch keine Stem-Dateien geladen. Lade Drums, Bass, Vocals und Other, dann Auto-Mapping erneut starten.") + state.ai.suggestions
            ))
            return
        }
        val bank = state.selectedBank
        val bankOffset = bank.ordinal * 16
        val mappedPads = state.pads.mapIndexed { globalIndex, pad ->
            if (globalIndex !in bankOffset until bankOffset + 16) return@mapIndexed pad
            val local = globalIndex - bankOffset
            val stem = when (local) {
                in 0..3 -> stems.firstOrNull { it.type == StemType.DRUMS }
                in 4..7 -> stems.firstOrNull { it.type == StemType.BASS }
                in 8..11 -> stems.firstOrNull { it.type == StemType.OTHER }
                else -> stems.firstOrNull { it.type == StemType.VOCALS }
            } ?: stems[local % stems.size]
            pad.copy(
                uri = stem.uri,
                label = stem.type.label + " " + (local + 1),
                category = stem.type
            )
        }
        state = state.copy(
            pads = mappedPads,
            ai = state.ai.copy(lastAccepted = "Auto-Pad-Mapping auf Bank " + bank.name + " erstellt")
        )
        mappedPads.forEachIndexed { index, pad -> pad.uri?.let { audio.assignPad(index, it) } }
        persistAndLog("pad.automap", bank.name)
    }

    fun acceptSuggestion(suggestion: String) {
        state = state.copy(ai = state.ai.copy(lastAccepted = suggestion))
        when {
            suggestion.contains("SAFE", ignoreCase = true) -> executeAutomation(
                AiAutomationPlanner.Candidate(AiAutomationPlanner.Command.SAFE_MODE, 1f, AiAutomationPlanner.Risk.LOW, suggestion)
            )
            suggestion.contains("Master", ignoreCase = true) -> executeAutomation(
                AiAutomationPlanner.Candidate(AiAutomationPlanner.Command.LOWER_MASTER, 1f, AiAutomationPlanner.Risk.LOW, suggestion)
            )
            suggestion.contains("synchron", ignoreCase = true) -> syncDeckToMaster(DeckId.B)
            suggestion.contains("Build", ignoreCase = true) -> triggerBuildFx()
            suggestion.contains("Drop", ignoreCase = true) -> triggerDropFx()
            suggestion.contains("Echo", ignoreCase = true) -> triggerGlitchFx()
        }
        persistAndLog("ai.accept", suggestion.take(80))
    }

    private fun handleMidi(action: MidiPerformanceAction) {
        when (action) {
            is MidiPerformanceAction.TriggerPad -> triggerPad(action.index, action.velocity)
            is MidiPerformanceAction.SetCrossfader -> setCrossfader(action.value)
            is MidiPerformanceAction.SetMaster -> setMasterVolume(action.value)
            is MidiPerformanceAction.TogglePlay -> togglePlay(action.deck)
            is MidiPerformanceAction.Cue -> cue(action.deck)
            is MidiPerformanceAction.Sync -> syncDeckToMaster(action.deck)
            MidiPerformanceAction.BuildFx -> triggerBuildFx()
            MidiPerformanceAction.DropFx -> triggerDropFx()
        }
    }

    fun release() {
        if (state.recording) stopRecording()
        persistence.save(state.copy(recording = false))
        midi.close()
        recovery.markCleanShutdown()
        audio.release()
    }
}

data class RecordingStats(
    val recording: Boolean,
    val recordedFrames: Long,
    val droppedFrames: Int,
)

class StudioAudioEngine(private val context: Context) {
    private val scope = CoroutineScope(Dispatchers.Main + Job())
    private val native = NativeAudioSession(context)
    private val deckPlayers = DeckId.entries.associateWith { newPlayer() }.toMutableMap()
    private val stemPlayers = mutableMapOf<Pair<DeckId, StemType>, ExoPlayer>()
    private val padPlayers = mutableMapOf<Int, ExoPlayer>()
    private val nativeDecks = mutableSetOf<DeckId>()
    private val nativeStems = mutableSetOf<Pair<DeckId, StemType>>()
    private val nativePads = mutableSetOf<Int>()
    private var lastBeatAnchorMs: Long = SystemClock.elapsedRealtime()

    private val audioGuard = PerformanceAudioGuard(context) {
        pauseDeck(DeckId.A)
        pauseDeck(DeckId.B)
    }

    private fun newPlayer(): ExoPlayer = ExoPlayer.Builder(context).build().apply {
        repeatMode = Player.REPEAT_MODE_OFF
    }

    fun loadDeck(deck: DeckId, uri: Uri) {
        if (native.loadDeck(deck, uri)) nativeDecks += deck else nativeDecks -= deck
        deckPlayers[deck]?.apply {
            stop()
            setPlaybackParameters(PlaybackParameters(1f))
            setMediaItem(MediaItem.fromUri(uri))
            prepare()
        }
    }

    fun loadStem(deck: DeckId, stem: StemType, uri: Uri) {
        val key = deck to stem
        if (native.loadStem(deck, stem, uri)) nativeStems += key else nativeStems -= key
        val player = stemPlayers.getOrPut(key) { newPlayer() }
        player.stop()
        player.setPlaybackParameters(PlaybackParameters(1f))
        player.setMediaItem(MediaItem.fromUri(uri))
        player.prepare()
    }

    private fun loadedStemEntries(deck: DeckId): List<Pair<Pair<DeckId, StemType>, ExoPlayer>> =
        stemPlayers.entries
            .filter { it.key.first == deck }
            .map { it.key to it.value }

    private fun usesNativeDeck(deck: DeckId): Boolean {
        val stems = loadedStemEntries(deck)
        return if (stems.isNotEmpty()) stems.all { it.first in nativeStems } else deck in nativeDecks
    }

    fun playDeck(deck: DeckId) {
        audioGuard.requestFocus()
        val stems = loadedStemEntries(deck)
        if (usesNativeDeck(deck)) {
            native.playDeck(deck)
        } else if (stems.isNotEmpty()) {
            stems.forEach { it.second.play() }
        } else {
            deckPlayers[deck]?.play()
        }
        lastBeatAnchorMs = SystemClock.elapsedRealtime()
    }

    fun pauseDeck(deck: DeckId) {
        native.pauseDeck(deck)
        deckPlayers[deck]?.pause()
        loadedStemEntries(deck).forEach { it.second.pause() }
    }

    fun cue(deck: DeckId) {
        native.cueDeck(deck)
        deckPlayers[deck]?.apply { pause(); seekTo(0) }
        loadedStemEntries(deck).forEach { (_, player) ->
            player.pause()
            player.seekTo(0)
        }
    }

    fun syncDeck(deck: DeckId, masterDeck: DeckId, sourceBpm: Float, targetBpm: Float) {
        if (sourceBpm <= 0f || targetBpm <= 0f) return
        val ratio = (targetBpm / sourceBpm).coerceIn(0.5f, 2f)
        native.sync(deck, masterDeck, sourceBpm, targetBpm)

        val sourcePlayers = loadedStemEntries(deck).map { it.second }.ifEmpty {
            listOfNotNull(deckPlayers[deck])
        }
        val masterPlayer = loadedStemEntries(masterDeck).firstOrNull()?.second ?: deckPlayers[masterDeck]
        val beatMs = (60_000f / targetBpm).roundToInt().coerceAtLeast(1)
        val phase = ((masterPlayer?.currentPosition ?: 0L) % beatMs).coerceAtLeast(0L)

        sourcePlayers.forEach { player ->
            player.setPlaybackParameters(PlaybackParameters(ratio))
            val current = player.currentPosition.coerceAtLeast(0L)
            val aligned = (current - (current % beatMs) + phase).coerceAtLeast(0L)
            player.seekTo(aligned)
        }
    }

    fun setHotCue(deck: DeckId, slot: Int): Double? {
        if (usesNativeDeck(deck) && native.setHotCue(deck, slot)) {
            return native.deckPositionSeconds(deck).takeIf { it >= 0.0 }
        }
        val player = loadedStemEntries(deck).firstOrNull()?.second ?: deckPlayers[deck]
        return player?.currentPosition?.coerceAtLeast(0L)?.div(1000.0)
    }

    fun jumpHotCue(deck: DeckId, slot: Int, seconds: Double) {
        if (usesNativeDeck(deck)) {
            if (!native.jumpHotCue(deck, slot)) native.seekDeckSeconds(deck, seconds)
            return
        }
        val targetMs = (seconds * 1000.0).toLong().coerceAtLeast(0L)
        deckPlayers[deck]?.seekTo(targetMs)
        loadedStemEntries(deck).forEach { it.second.seekTo(targetMs) }
    }

    fun setBeatLoop(deck: DeckId, beats: Int, bpm: Float): Boolean =
        usesNativeDeck(deck) && native.setBeatLoop(deck, beats, bpm)

    fun clearLoop(deck: DeckId) {
        native.clearLoop(deck)
    }

    fun assignPad(globalIndex: Int, uri: Uri) {
        if (native.loadPad(globalIndex, uri)) nativePads += globalIndex else nativePads -= globalIndex
        val player = padPlayers.getOrPut(globalIndex) { newPlayer() }
        player.setMediaItem(MediaItem.fromUri(uri))
        player.prepare()
    }

    fun triggerPad(globalIndex: Int, quantize: Boolean, bpm: Float, gain: Float = 1f) {
        val safeGain = gain.coerceIn(0f, 1.5f)
        val fire: () -> Unit = {
            if (globalIndex in nativePads) {
                native.triggerPad(globalIndex, safeGain)
            } else {
                padPlayers[globalIndex]?.apply {
                    volume = safeGain.coerceIn(0f, 1f)
                    seekTo(0)
                    play()
                }
            }
        }
        if (!quantize) {
            fire()
            return
        }
        val beatMs = (60_000f / bpm).roundToInt().coerceAtLeast(1)
        val now = SystemClock.elapsedRealtime()
        val elapsed = now - lastBeatAnchorMs
        val delayMs = beatMs - (elapsed % beatMs)
        scope.launch {
            delay(delayMs)
            fire()
        }
    }

    fun setMix(crossfader: Float, masterVolume: Float, state: StudioState) {
        native.setMix(crossfader, masterVolume)
        state.deckA.stems.forEach { stem ->
            native.setStemGain(DeckId.A, stem.type, nativeStemGain(state.deckA, stem))
        }
        state.deckB.stems.forEach { stem ->
            native.setStemGain(DeckId.B, stem.type, nativeStemGain(state.deckB, stem))
        }

        applyDeckVolume(DeckId.A, deckGain(DeckId.A, crossfader) * masterVolume, state.deckA)
        applyDeckVolume(DeckId.B, deckGain(DeckId.B, crossfader) * masterVolume, state.deckB)
    }

    private fun nativeStemGain(deckState: DeckState, stem: StemChannelState): Float {
        val soloActive = deckState.stems.any { it.solo }
        val active = if (soloActive) stem.solo else !stem.muted
        return if (active) stem.volume else 0f
    }

    private fun deckGain(deck: DeckId, crossfader: Float): Float =
        when (deck) {
            DeckId.A -> (1f - max(0f, crossfader)).coerceIn(0f, 1f)
            DeckId.B -> (1f + min(0f, crossfader)).coerceIn(0f, 1f)
        }

    private fun applyDeckVolume(deck: DeckId, deckGain: Float, deckState: DeckState) {
        val soloActive = deckState.stems.any { it.solo }
        deckPlayers[deck]?.volume = deckGain
        deckState.stems.forEach { stem ->
            val active = if (soloActive) stem.solo else !stem.muted
            stemPlayers[deck to stem.type]?.volume = if (active) deckGain * stem.volume else 0f
        }
    }

    fun buildFx(amount: Float, state: StudioState) {
        native.buildFx(amount)
        val original = state.masterVolume
        scope.launch {
            repeat(8) { step ->
                val duck = original * (1f - (amount * 0.05f * step))
                applyFallbackMix(state.crossfader, duck.coerceIn(0.4f, 1f), state)
                delay(180)
            }
            applyFallbackMix(state.crossfader, original, state)
        }
    }

    fun dropFx(amount: Float, state: StudioState) {
        native.dropFx(amount)
        val original = state.masterVolume
        scope.launch {
            applyFallbackMix(state.crossfader, (original * (1f - amount)).coerceIn(0f, 1f), state)
            delay(110)
            applyFallbackMix(state.crossfader, original, state)
        }
    }

    fun glitchFx(amount: Float, state: StudioState) {
        native.glitchFx(amount)
        scope.launch {
            val fallbackDecks = DeckId.entries.filterNot(::usesNativeDeck)
            repeat((4 + amount * 8).roundToInt()) {
                fallbackDecks.forEach { deck ->
                    deckPlayers[deck]?.let { player ->
                        val pos = player.currentPosition
                        player.seekTo((pos - 90).coerceAtLeast(0))
                    }
                    loadedStemEntries(deck).forEach { (_, player) ->
                        val pos = player.currentPosition
                        player.seekTo((pos - 90).coerceAtLeast(0))
                    }
                }
                delay(95)
            }
        }
    }

    private fun applyFallbackMix(crossfader: Float, masterVolume: Float, state: StudioState) {
        applyDeckVolume(DeckId.A, deckGain(DeckId.A, crossfader) * masterVolume, state.deckA)
        applyDeckVolume(DeckId.B, deckGain(DeckId.B, crossfader) * masterVolume, state.deckB)
    }

    fun setLimiterEnabled(enabled: Boolean) {
        native.setLimiterEnabled(enabled)
    }

    fun startRecording(uri: Uri): Boolean {
        val hasNativeSource = nativeDecks.isNotEmpty() || nativeStems.isNotEmpty() || nativePads.isNotEmpty()
        return hasNativeSource && native.startRecording(uri)
    }

    fun stopRecording(): RecordingStats {
        native.stopRecording()
        val stats = native.recordingStats()
        return RecordingStats(
            recording = stats.getOrElse(0) { 0f } >= 0.5f,
            recordedFrames = stats.getOrElse(1) { 0f }.toLong().coerceAtLeast(0L),
            droppedFrames = stats.getOrElse(2) { 0f }.toInt().coerceAtLeast(0),
        )
    }

    fun nativeMeters(): FloatArray = native.meters()

    fun telemetrySnapshot(eventCount: Int): LiveTelemetryDashboard.Snapshot {
        val meters = LivePerformanceCopilot.meters(native.meters())
        val rec = native.recordingStats()
        val focus = audioGuard.snapshot()
        return LiveTelemetryDashboard.Snapshot(
            peak = meters.peak,
            xruns = meters.xruns,
            engineRunning = meters.engineRunning,
            recording = rec.getOrElse(0) { 0f } >= 0.5f,
            recordingDroppedFrames = rec.getOrElse(2) { 0f }.toInt().coerceAtLeast(0),
            audioFocus = focus.hasFocus,
            outputDevices = focus.outputDeviceCount,
            eventCount = eventCount,
        )
    }

    fun release() {
        native.stopRecording()
        audioGuard.close()
        native.release()
        deckPlayers.values.forEach { it.release() }
        stemPlayers.values.forEach { it.release() }
        padPlayers.values.forEach { it.release() }
        scope.coroutineContext[Job]?.cancel()
    }
}

private fun StudioState.deck(deck: DeckId): DeckState = if (deck == DeckId.A) deckA else deckB
private fun StudioState.updateDeck(deck: DeckId, block: (DeckState) -> DeckState): StudioState =
    if (deck == DeckId.A) copy(deckA = block(deckA)) else copy(deckB = block(deckB))

private fun StudioState.updateStem(deck: DeckId, stem: StemType, block: (StemChannelState) -> StemChannelState): StudioState =
    updateDeck(deck) { deckState ->
        deckState.copy(stems = deckState.stems.map { if (it.type == stem) block(it) else it })
    }

@Composable
fun TopBar(state: StudioState) {
    GlassCard {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column {
                Text("LiveAudioPerformance Studio", fontSize = 20.sp, fontWeight = FontWeight.Bold)
                Text("Performance Reliability v0.4 · Native Audio · MIDI · REC · AI Copilot", fontSize = 12.sp, color = Color(0xFF93A4C7))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Metric("Master", "${(state.masterVolume * 100).roundToInt()}%")
                Metric("XFader", when {
                    state.crossfader < -0.05f -> "A ${(kotlin.math.abs(state.crossfader) * 100).roundToInt()}"
                    state.crossfader > 0.05f -> "B ${(state.crossfader * 100).roundToInt()}"
                    else -> "Center"
                })
                Metric("Bank", state.selectedBank.name)
            }
        }
    }
}

@Composable
fun TabBar(selected: StudioTab, onSelected: (StudioTab) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        StudioTab.entries.forEach { tab ->
            val active = selected == tab
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(14.dp))
                    .background(if (active) Color(0xFF6236FF) else Color(0xFF111827))
                    .border(1.dp, if (active) Color(0xFF9E7CFF) else Color(0xFF24304A), RoundedCornerShape(14.dp))
                    .clickable { onSelected(tab) }
                    .padding(horizontal = 18.dp, vertical = 10.dp)
            ) {
                Text(tab.label, fontWeight = if (active) FontWeight.Bold else FontWeight.Normal)
            }
        }
    }
}

@Composable
fun DecksScreen(
    state: StudioState,
    onImportDeck: (DeckId) -> Unit,
    onPlayPause: (DeckId) -> Unit,
    onCue: (DeckId) -> Unit,
    onSync: (DeckId) -> Unit,
    onSetHotCue: (DeckId, Int) -> Unit,
    onJumpHotCue: (DeckId, Int) -> Unit,
    onLoop: (DeckId) -> Unit,
    onCrossfader: (Float) -> Unit,
    onMasterVolume: (Float) -> Unit,
    onBpm: (DeckId, Float) -> Unit,
) {
    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                DeckCard(
                    modifier = Modifier.weight(1f),
                    deck = state.deckA,
                    onImport = { onImportDeck(DeckId.A) },
                    onPlayPause = { onPlayPause(DeckId.A) },
                    onCue = { onCue(DeckId.A) },
                    onSync = { onSync(DeckId.A) },
                    onSetHotCue = { onSetHotCue(DeckId.A, it) },
                    onJumpHotCue = { onJumpHotCue(DeckId.A, it) },
                    onLoop = { onLoop(DeckId.A) },
                    onBpm = { onBpm(DeckId.A, it) }
                )
                DeckCard(
                    modifier = Modifier.weight(1f),
                    deck = state.deckB,
                    onImport = { onImportDeck(DeckId.B) },
                    onPlayPause = { onPlayPause(DeckId.B) },
                    onCue = { onCue(DeckId.B) },
                    onSync = { onSync(DeckId.B) },
                    onSetHotCue = { onSetHotCue(DeckId.B, it) },
                    onJumpHotCue = { onJumpHotCue(DeckId.B, it) },
                    onLoop = { onLoop(DeckId.B) },
                    onBpm = { onBpm(DeckId.B, it) }
                )
            }
        }
        item {
            GlassCard {
                Text("Master Output", fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(8.dp))
                Text("Crossfader: ${state.crossfader.format2()}  ·  Master: ${(state.masterVolume * 100).roundToInt()}%", color = Color(0xFF93A4C7))
                Slider(value = state.crossfader, onValueChange = onCrossfader, valueRange = -1f..1f)
                Slider(value = state.masterVolume, onValueChange = onMasterVolume, valueRange = 0f..1f)
            }
        }
    }
}

@Composable
fun DeckCard(
    modifier: Modifier = Modifier,
    deck: DeckState,
    onImport: () -> Unit,
    onPlayPause: () -> Unit,
    onCue: () -> Unit,
    onSync: () -> Unit,
    onSetHotCue: (Int) -> Unit,
    onJumpHotCue: (Int) -> Unit,
    onLoop: () -> Unit,
    onBpm: (Float) -> Unit,
) {
    GlassCard(modifier = modifier) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(deck.id.label, color = if (deck.id == DeckId.A) Color(0xFF00D5FF) else Color(0xFFFF4F7B), fontWeight = FontWeight.Bold)
                Text(deck.title, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            OutlinedButton(onClick = onImport) { Text("Song laden") }
        }
        Spacer(Modifier.height(10.dp))
        WaveformMock(deck.id, deck.isPlaying)
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = onPlayPause) { Text(if (deck.isPlaying) "Pause" else "Play") }
            OutlinedButton(onClick = onCue) { Text("Cue") }
            OutlinedButton(onClick = onSync) { Text("Sync") }
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            repeat(4) { slot ->
                val isSet = deck.hotCuesSeconds.getOrNull(slot) != null
                SmallAction(if (isSet) "C" + (slot + 1) else "Set C" + (slot + 1)) {
                    if (isSet) onJumpHotCue(slot) else onSetHotCue(slot)
                }
            }
            SmallAction(if (deck.loopBeats > 0) "Loop 4 ✓" else "Loop 4") { onLoop() }
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Metric("BPM", deck.bpm.roundToInt().toString())
            Metric("Key", deck.key)
            Metric("Stems", "${deck.stems.count { it.uri != null }}/4")
        }
        Spacer(Modifier.height(8.dp))
        Text("BPM manuell", color = Color(0xFF93A4C7), fontSize = 12.sp)
        Slider(value = deck.bpm, onValueChange = onBpm, valueRange = 60f..220f)
    }
}

@Composable
fun StemsScreen(
    state: StudioState,
    onImportStem: (DeckId, StemType) -> Unit,
    onVolume: (DeckId, StemType, Float) -> Unit,
    onMute: (DeckId, StemType) -> Unit,
    onSolo: (DeckId, StemType) -> Unit,
    onPlayPause: (DeckId) -> Unit,
) {
    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                StemDeckMixer(Modifier.weight(1f), state.deckA, onImportStem, onVolume, onMute, onSolo, onPlayPause)
                StemDeckMixer(Modifier.weight(1f), state.deckB, onImportStem, onVolume, onMute, onSolo, onPlayPause)
            }
        }
    }
}

@Composable
fun StemDeckMixer(
    modifier: Modifier,
    deck: DeckState,
    onImportStem: (DeckId, StemType) -> Unit,
    onVolume: (DeckId, StemType, Float) -> Unit,
    onMute: (DeckId, StemType) -> Unit,
    onSolo: (DeckId, StemType) -> Unit,
    onPlayPause: (DeckId) -> Unit,
) {
    GlassCard(modifier) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Column { Text("${deck.id.label} Stem Mixer", fontWeight = FontWeight.Bold); Text(deck.title, color = Color(0xFF93A4C7), maxLines = 1) }
            Button(onClick = { onPlayPause(deck.id) }) { Text(if (deck.isPlaying) "Pause" else "Play") }
        }
        Spacer(Modifier.height(8.dp))
        deck.stems.forEach { stem ->
            StemStrip(deck.id, stem, onImportStem, onVolume, onMute, onSolo)
        }
    }
}

@Composable
fun StemStrip(
    deck: DeckId,
    stem: StemChannelState,
    onImportStem: (DeckId, StemType) -> Unit,
    onVolume: (DeckId, StemType, Float) -> Unit,
    onMute: (DeckId, StemType) -> Unit,
    onSolo: (DeckId, StemType) -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(stem.type.label, fontWeight = FontWeight.Bold, color = stemColor(stem.type))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                OutlinedButton(onClick = { onImportStem(deck, stem.type) }) { Text(if (stem.uri == null) "Laden" else "Ersetzen") }
                OutlinedButton(onClick = { onMute(deck, stem.type) }) { Text(if (stem.muted) "Muted" else "Mute") }
                OutlinedButton(onClick = { onSolo(deck, stem.type) }) { Text(if (stem.solo) "Solo ✓" else "Solo") }
            }
        }
        Slider(value = stem.volume, onValueChange = { onVolume(deck, stem.type, it) }, valueRange = 0f..1f)
    }
}

@Composable
fun PadsScreen(
    state: StudioState,
    onSelectBank: (PadBank) -> Unit,
    onAssignPad: (Int) -> Unit,
    onTriggerPad: (Int) -> Unit,
    onQuantize: (Boolean) -> Unit,
) {
    val bankOffset = state.selectedBank.ordinal * 16
    val visiblePads = state.pads.drop(bankOffset).take(16)
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        GlassCard {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PadBank.entries.forEach { bank ->
                        OutlinedButton(onClick = { onSelectBank(bank) }) { Text(if (state.selectedBank == bank) "Bank ${bank.name} ✓" else "Bank ${bank.name}") }
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Quantize", color = Color(0xFF93A4C7))
                    Spacer(Modifier.width(8.dp))
                    Switch(checked = state.quantizePads, onCheckedChange = onQuantize)
                }
            }
        }

        GlassCard {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                repeat(4) { row ->
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                        repeat(4) { col ->
                            val pad = visiblePads[row * 4 + col]
                            PadCell(
                                modifier = Modifier.weight(1f),
                                pad = pad,
                                globalIndex = bankOffset + pad.index,
                                onAssign = onAssignPad,
                                onTrigger = onTriggerPad
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun PadCell(
    modifier: Modifier,
    pad: PadState,
    globalIndex: Int,
    onAssign: (Int) -> Unit,
    onTrigger: (Int) -> Unit,
) {
    val bg = pad.category?.let { stemColor(it).copy(alpha = 0.25f) } ?: Color(0xFF151B2A)
    Column(
        modifier = modifier
            .height(84.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(bg)
            .border(1.dp, pad.category?.let { stemColor(it) } ?: Color(0xFF2C3755), RoundedCornerShape(16.dp))
            .padding(8.dp),
        verticalArrangement = Arrangement.SpaceBetween
    ) {
        Text("${pad.index + 1}", fontWeight = FontWeight.Bold)
        Text(pad.label, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 12.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            SmallAction("Play") { onTrigger(globalIndex) }
            SmallAction("Load") { onAssign(globalIndex) }
        }
    }
}

@Composable
fun FxScreen(
    state: StudioState,
    onBuild: () -> Unit,
    onDrop: () -> Unit,
    onGlitch: () -> Unit,
    onMacro: (Float) -> Unit,
    onLimiter: (Boolean) -> Unit,
    onStartRecording: () -> Unit,
    onStopRecording: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        GlassCard {
            Text("Makro-FX", fontSize = 20.sp, fontWeight = FontWeight.Bold)
            Text("Aktiv: ${state.fx.activeMacro}", color = Color(0xFF93A4C7))
            Spacer(Modifier.height(8.dp))
            Text("FX-Makro-Regler: ${(state.fx.macroAmount * 100).roundToInt()}%")
            Slider(value = state.fx.macroAmount, onValueChange = onMacro, valueRange = 0f..1f)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Button(onClick = onBuild) { Text("Build FX") }
                Button(onClick = onDrop) { Text("Drop FX") }
                Button(onClick = onGlitch) { Text("Glitch FX") }
            }
        }
        GlassCard {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Column {
                    Text("Master Limiter", fontWeight = FontWeight.Bold)
                    Text("Native Soft-Limiter im AAudio-Masterbus.", color = Color(0xFF93A4C7))
                }
                Switch(checked = state.fx.limiterEnabled, onCheckedChange = onLimiter)
            }
        }
        GlassCard {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Column {
                    Text("Native Master Recording", fontWeight = FontWeight.Bold)
                    Text(state.recordingStatus, color = if (state.recording) Color(0xFFFF4F7B) else Color(0xFF93A4C7))
                }
                if (state.recording) {
                    Button(onClick = onStopRecording) { Text("Stop REC") }
                } else {
                    Button(onClick = onStartRecording) { Text("Start REC") }
                }
            }
            Spacer(Modifier.height(6.dp))
            Text("WAV-Aufnahme des nativen Master-Bus; Media3-Fallback-Quellen werden nicht in den nativen Recorder gespiegelt.", color = Color(0xFF93A4C7), fontSize = 12.sp)
        }
    }
}

@Composable
fun AiScreen(
    state: StudioState,
    onAnalyze: () -> Unit,
    onAutoMap: () -> Unit,
    onAcceptSuggestion: (String) -> Unit,
    onAutopilot: (Boolean) -> Unit,
) {
    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            GlassCard {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Column {
                        Text("AI Workflow", fontSize = 20.sp, fontWeight = FontWeight.Bold)
                        Text("Song-Analyse · Auto-Pad-Mapping · Übergangsvorschläge", color = Color(0xFF93A4C7))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Guarded Autopilot", color = Color(0xFF93A4C7), fontSize = 12.sp)
                            Spacer(Modifier.width(8.dp))
                            Switch(checked = state.ai.autopilotEnabled, onCheckedChange = onAutopilot)
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = onAnalyze) { Text("Analysieren") }
                        Button(onClick = onAutoMap) { Text("Auto-Mapping") }
                    }
                }
            }
        }
        item {
            GlassCard {
                Text("Live Health", fontWeight = FontWeight.Bold)
                Text(state.ai.healthHeadline, color = Color(0xFF00D5FF))
                if (state.recoveredSession) {
                    Text("Recovery: vorherige Session wurde wiederhergestellt.", color = Color(0xFFFFB44C), fontSize = 12.sp)
                }
            }
        }
        item {
            val analysis = state.ai.analysis
            GlassCard {
                Text("Analyse", fontWeight = FontWeight.Bold)
                if (analysis == null) {
                    Text("Noch keine Analyse vorhanden.", color = Color(0xFF93A4C7))
                } else {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Metric("BPM", analysis.bpm.roundToInt().toString())
                        Metric("Key", analysis.key)
                        Metric("Energy", analysis.energy.toString())
                        Metric("Loop", analysis.bestLoopPoint)
                        Metric("Stems", analysis.stemReadiness)
                    }
                }
            }
        }
        item {
            GlassCard {
                Text("Übergangsvorschläge", fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(8.dp))
                state.ai.suggestions.forEach { suggestion ->
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 5.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(suggestion, modifier = Modifier.weight(1f), color = Color(0xFFE8ECF8))
                        OutlinedButton(onClick = { onAcceptSuggestion(suggestion) }) { Text("Übernehmen") }
                    }
                }
                state.ai.lastAccepted?.let {
                    Spacer(Modifier.height(8.dp))
                    Text("Zuletzt übernommen: $it", color = Color(0xFF00D5FF))
                }
            }
        }
    }
}

@Composable
fun GlassCard(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(containerColor = Color(0xCC0D111A)),
        shape = RoundedCornerShape(22.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Box(
            modifier = Modifier
                .border(1.dp, Color(0xFF22304D), RoundedCornerShape(22.dp))
                .padding(14.dp)
        ) { content() }
    }
}

@Composable
fun Metric(label: String, value: String) {
    Column(
        modifier = Modifier
            .clip(RoundedCornerShape(12.dp))
            .background(Color(0xFF111827))
            .border(1.dp, Color(0xFF283554), RoundedCornerShape(12.dp))
            .padding(horizontal = 10.dp, vertical = 8.dp)
    ) {
        Text(label, color = Color(0xFF93A4C7), fontSize = 11.sp)
        Text(value, fontWeight = FontWeight.Bold, fontSize = 13.sp)
    }
}

@Composable
fun WaveformMock(deck: DeckId, active: Boolean) {
    val color = if (deck == DeckId.A) Color(0xFF00D5FF) else Color(0xFFFF4F7B)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(72.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(Color(0xFF070B13))
            .border(1.dp, color.copy(alpha = if (active) 0.85f else 0.35f), RoundedCornerShape(14.dp))
            .padding(6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(3.dp)
    ) {
        repeat(54) { i ->
            val h = (((i * 37) % 52) + 10).dp
            Box(
                modifier = Modifier
                    .width(4.dp)
                    .height(h)
                    .clip(RoundedCornerShape(3.dp))
                    .background(color.copy(alpha = if (active) 0.95f else 0.55f))
            )
        }
    }
}

@Composable
fun SmallAction(label: String, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(Color(0xFF0B1020))
            .border(1.dp, Color(0xFF2C3755), RoundedCornerShape(8.dp))
            .clickable { onClick() }
            .padding(horizontal = 8.dp, vertical = 4.dp)
    ) {
        Text(label, fontSize = 11.sp)
    }
}

fun stemColor(stem: StemType): Color = when (stem) {
    StemType.DRUMS -> Color(0xFFFF6B35)
    StemType.BASS -> Color(0xFF28A8FF)
    StemType.VOCALS -> Color(0xFFC75CFF)
    StemType.OTHER -> Color(0xFF78E050)
}

private fun Float.format2(): String = "%.2f".format(this)
