#include <aaudio/AAudio.h>
#include <jni.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <memory>
#include <thread>
#include <chrono>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#include <vector>

namespace {

constexpr int kDeckCount = 2;
constexpr int kStemCount = 4;
constexpr int kPadCount = 64;
constexpr int kHotCueCount = 8;
constexpr double kPi = 3.14159265358979323846;
constexpr int64_t kMaxAudioBytes = 512LL * 1024LL * 1024LL;

uint16_t readU16(const uint8_t* p) {
    return static_cast<uint16_t>(p[0]) |
           (static_cast<uint16_t>(p[1]) << 8);
}

uint32_t readU32(const uint8_t* p) {
    return static_cast<uint32_t>(p[0]) |
           (static_cast<uint32_t>(p[1]) << 8) |
           (static_cast<uint32_t>(p[2]) << 16) |
           (static_cast<uint32_t>(p[3]) << 24);
}

int32_t readS24(const uint8_t* p) {
    int32_t v = static_cast<int32_t>(p[0]) |
                (static_cast<int32_t>(p[1]) << 8) |
                (static_cast<int32_t>(p[2]) << 16);
    if (v & 0x00800000) v |= 0xFF000000;
    return v;
}

struct AudioClip {
    int32_t sampleRate = 0;
    int32_t channels = 0;
    std::vector<float> samples;

    int64_t frameCount() const {
        return channels > 0 ? static_cast<int64_t>(samples.size() / channels) : 0;
    }
};

std::shared_ptr<const AudioClip> loadWavFromFd(int fd, int64_t startOffset, int64_t declaredLength) {
    if (fd < 0 || startOffset < 0) return nullptr;

    struct stat st {};
    if (fstat(fd, &st) != 0) return nullptr;

    int64_t available = declaredLength;
    if (available <= 0) available = static_cast<int64_t>(st.st_size) - startOffset;
    if (available < 44 || available > kMaxAudioBytes) return nullptr;

    std::vector<uint8_t> bytes(static_cast<size_t>(available));
    size_t total = 0;
    while (total < bytes.size()) {
        const ssize_t n = pread(
            fd,
            bytes.data() + total,
            bytes.size() - total,
            static_cast<off_t>(startOffset + static_cast<int64_t>(total))
        );
        if (n <= 0) break;
        total += static_cast<size_t>(n);
    }
    if (total < 44) return nullptr;
    bytes.resize(total);

    if (std::memcmp(bytes.data(), "RIFF", 4) != 0 ||
        std::memcmp(bytes.data() + 8, "WAVE", 4) != 0) {
        return nullptr;
    }

    uint16_t audioFormat = 0;
    uint16_t channels = 0;
    uint32_t sampleRate = 0;
    uint16_t bitsPerSample = 0;
    const uint8_t* dataPtr = nullptr;
    uint32_t dataSize = 0;

    size_t cursor = 12;
    while (cursor + 8 <= bytes.size()) {
        const uint8_t* chunk = bytes.data() + cursor;
        const uint32_t chunkSize = readU32(chunk + 4);
        const size_t payload = cursor + 8;
        if (payload + chunkSize > bytes.size()) break;

        if (std::memcmp(chunk, "fmt ", 4) == 0 && chunkSize >= 16) {
            audioFormat = readU16(bytes.data() + payload);
            channels = readU16(bytes.data() + payload + 2);
            sampleRate = readU32(bytes.data() + payload + 4);
            bitsPerSample = readU16(bytes.data() + payload + 14);
        } else if (std::memcmp(chunk, "data", 4) == 0) {
            dataPtr = bytes.data() + payload;
            dataSize = chunkSize;
        }

        cursor = payload + chunkSize + (chunkSize & 1U);
    }

    if (dataPtr == nullptr || dataSize == 0 || sampleRate == 0 ||
        channels < 1 || channels > 2) {
        return nullptr;
    }

    const int bytesPerSample = bitsPerSample / 8;
    if (bytesPerSample <= 0) return nullptr;
    if (!(audioFormat == 1 || audioFormat == 3)) return nullptr;
    if (audioFormat == 3 && bitsPerSample != 32) return nullptr;
    if (audioFormat == 1 &&
        !(bitsPerSample == 16 || bitsPerSample == 24 || bitsPerSample == 32)) {
        return nullptr;
    }

    const size_t sampleCount = dataSize / static_cast<size_t>(bytesPerSample);
    if (sampleCount == 0 || sampleCount % channels != 0) return nullptr;

    auto clip = std::make_shared<AudioClip>();
    clip->sampleRate = static_cast<int32_t>(sampleRate);
    clip->channels = static_cast<int32_t>(channels);
    clip->samples.resize(sampleCount);

    for (size_t i = 0; i < sampleCount; ++i) {
        const uint8_t* p = dataPtr + i * bytesPerSample;
        float value = 0.0f;
        if (audioFormat == 3) {
            float f = 0.0f;
            std::memcpy(&f, p, sizeof(float));
            value = std::isfinite(f) ? f : 0.0f;
        } else if (bitsPerSample == 16) {
            const int16_t v = static_cast<int16_t>(readU16(p));
            value = static_cast<float>(v) / 32768.0f;
        } else if (bitsPerSample == 24) {
            value = static_cast<float>(readS24(p)) / 8388608.0f;
        } else {
            const int32_t v = static_cast<int32_t>(readU32(p));
            value = static_cast<float>(static_cast<double>(v) / 2147483648.0);
        }
        clip->samples[i] = std::clamp(value, -1.0f, 1.0f);
    }
    return clip;
}

struct StreamState {
    std::shared_ptr<const AudioClip> clip;
    std::atomic<double> positionFrames{0.0};
    std::atomic<double> tempoRatio{1.0};
    std::atomic<float> gain{1.0f};
    std::atomic<bool> playing{false};
};

class LiveAudioEngine {
public:
    LiveAudioEngine(int32_t sampleRate, int32_t channelCount)
        : sampleRate_(sampleRate),
          channelCount_(channelCount),
          delayLeft_(static_cast<size_t>(sampleRate * 2), 0.0f),
          delayRight_(static_cast<size_t>(sampleRate * 2), 0.0f),
          recordRing_(static_cast<size_t>(sampleRate * 2 * 10), 0) {
        for (auto& deck : hotCueSeconds_) {
            for (auto& cue : deck) cue.store(-1.0);
        }
        for (auto& value : loopStartSeconds_) value.store(0.0);
        for (auto& value : loopEndSeconds_) value.store(0.0);
        for (auto& value : loopEnabled_) value.store(false);
    }

    ~LiveAudioEngine() {
        stopRecording();
        stop();
    }

    bool start() {
        if (stream_ != nullptr) return true;

        AAudioStreamBuilder* builder = nullptr;
        if (AAudio_createStreamBuilder(&builder) != AAUDIO_OK || builder == nullptr) return false;

        AAudioStreamBuilder_setDirection(builder, AAUDIO_DIRECTION_OUTPUT);
        AAudioStreamBuilder_setPerformanceMode(builder, AAUDIO_PERFORMANCE_MODE_LOW_LATENCY);
        AAudioStreamBuilder_setSharingMode(builder, AAUDIO_SHARING_MODE_SHARED);
        AAudioStreamBuilder_setFormat(builder, AAUDIO_FORMAT_PCM_FLOAT);
        AAudioStreamBuilder_setSampleRate(builder, sampleRate_);
        AAudioStreamBuilder_setChannelCount(builder, channelCount_);
        AAudioStreamBuilder_setDataCallback(builder, &LiveAudioEngine::dataCallback, this);
        AAudioStreamBuilder_setErrorCallback(builder, &LiveAudioEngine::errorCallback, this);

        const aaudio_result_t openResult = AAudioStreamBuilder_openStream(builder, &stream_);
        AAudioStreamBuilder_delete(builder);
        if (openResult != AAUDIO_OK || stream_ == nullptr) {
            stream_ = nullptr;
            return false;
        }

        const aaudio_result_t startResult = AAudioStream_requestStart(stream_);
        if (startResult != AAUDIO_OK) {
            AAudioStream_close(stream_);
            stream_ = nullptr;
            return false;
        }

        running_.store(true, std::memory_order_release);
        return true;
    }

    void stop() {
        running_.store(false, std::memory_order_release);
        if (stream_ != nullptr) {
            AAudioStream_requestStop(stream_);
            AAudioStream_close(stream_);
            stream_ = nullptr;
        }
    }

    bool loadDeck(int deck, int fd, int64_t offset, int64_t length) {
        if (!validDeck(deck)) return false;
        auto clip = loadWavFromFd(fd, offset, length);
        if (!clip) return false;
        std::atomic_store_explicit(&decks_[deck].clip, clip, std::memory_order_release);
        decks_[deck].positionFrames.store(0.0);
        decks_[deck].playing.store(false);
        return true;
    }

    bool loadStem(int deck, int stem, int fd, int64_t offset, int64_t length) {
        if (!validDeck(deck) || stem < 0 || stem >= kStemCount) return false;
        auto clip = loadWavFromFd(fd, offset, length);
        if (!clip) return false;
        auto& state = stems_[deck][stem];
        std::atomic_store_explicit(&state.clip, clip, std::memory_order_release);
        state.positionFrames.store(0.0);
        state.playing.store(false);
        deckUsesStems_[deck].store(true);
        return true;
    }

    bool loadPad(int pad, int fd, int64_t offset, int64_t length) {
        if (pad < 0 || pad >= kPadCount) return false;
        auto clip = loadWavFromFd(fd, offset, length);
        if (!clip) return false;
        auto& state = pads_[pad];
        std::atomic_store_explicit(&state.clip, clip, std::memory_order_release);
        state.positionFrames.store(0.0);
        state.playing.store(false);
        return true;
    }

    void playDeck(int deck) {
        if (!validDeck(deck)) return;
        if (deckUsesStems_[deck].load()) {
            for (auto& stem : stems_[deck]) {
                if (std::atomic_load_explicit(&stem.clip, std::memory_order_acquire)) {
                    stem.playing.store(true);
                }
            }
            decks_[deck].playing.store(false);
        } else if (std::atomic_load_explicit(&decks_[deck].clip, std::memory_order_acquire)) {
            decks_[deck].playing.store(true);
        }
    }

    void pauseDeck(int deck) {
        if (!validDeck(deck)) return;
        decks_[deck].playing.store(false);
        for (auto& stem : stems_[deck]) stem.playing.store(false);
    }

    void cueDeck(int deck) {
        if (!validDeck(deck)) return;
        pauseDeck(deck);
        decks_[deck].positionFrames.store(0.0);
        for (auto& stem : stems_[deck]) stem.positionFrames.store(0.0);
    }

    bool setHotCue(int deck, int slot) {
        if (!validDeck(deck) || slot < 0 || slot >= kHotCueCount) return false;
        const double seconds = deckPositionSeconds(deck);
        if (seconds < 0.0) return false;
        hotCueSeconds_[deck][slot].store(seconds, std::memory_order_release);
        return true;
    }

    bool jumpHotCue(int deck, int slot) {
        if (!validDeck(deck) || slot < 0 || slot >= kHotCueCount) return false;
        const double seconds = hotCueSeconds_[deck][slot].load(std::memory_order_acquire);
        if (seconds < 0.0) return false;
        setDeckPositionSeconds(deck, seconds);
        return true;
    }

    void clearHotCue(int deck, int slot) {
        if (!validDeck(deck) || slot < 0 || slot >= kHotCueCount) return;
        hotCueSeconds_[deck][slot].store(-1.0, std::memory_order_release);
    }

    bool setBeatLoop(int deck, int beats, float bpm) {
        if (!validDeck(deck) || beats <= 0 || bpm <= 0.0f) return false;
        const double start = deckPositionSeconds(deck);
        if (start < 0.0) return false;
        const double duration = static_cast<double>(beats) * 60.0 / static_cast<double>(bpm);
        loopStartSeconds_[deck].store(start, std::memory_order_release);
        loopEndSeconds_[deck].store(start + duration, std::memory_order_release);
        loopEnabled_[deck].store(true, std::memory_order_release);
        return true;
    }

    void clearLoop(int deck) {
        if (!validDeck(deck)) return;
        loopEnabled_[deck].store(false, std::memory_order_release);
    }

    double deckPositionSeconds(int deck) const {
        if (!validDeck(deck)) return -1.0;
        auto clip = activeClipForDeck(deck);
        if (!clip || clip->sampleRate <= 0) return -1.0;
        return activePositionForDeck(deck) / static_cast<double>(clip->sampleRate);
    }

    bool seekDeckSeconds(int deck, double seconds) {
        if (!validDeck(deck) || seconds < 0.0) return false;
        auto clip = activeClipForDeck(deck);
        if (!clip) return false;
        const double maxSeconds = static_cast<double>(clip->frameCount()) / clip->sampleRate;
        setDeckPositionSeconds(deck, std::min(seconds, maxSeconds));
        return true;
    }

    bool startRecording(int fd) {
        if (fd < 0) return false;
        stopRecording();

        const int ownedFd = dup(fd);
        if (ownedFd < 0) return false;
        if (ftruncate(ownedFd, 0) != 0 || lseek(ownedFd, 0, SEEK_SET) < 0) {
            close(ownedFd);
            return false;
        }

        recordFd_ = ownedFd;
        recordRead_.store(0);
        recordWrite_.store(0);
        recordDroppedFrames_.store(0);
        recordedSamples_.store(0);
        writeWavHeader(recordFd_, 0);
        recording_.store(true, std::memory_order_release);
        recordThread_ = std::thread(&LiveAudioEngine::recordWriterLoop, this);
        return true;
    }

    void stopRecording() {
        recording_.store(false, std::memory_order_release);
        if (recordThread_.joinable()) recordThread_.join();
        if (recordFd_ >= 0) {
            const uint64_t dataBytes = recordedSamples_.load() * sizeof(int16_t);
            writeWavHeader(recordFd_, static_cast<uint32_t>(std::min<uint64_t>(dataBytes, 0xFFFFFFFFu)));
            fsync(recordFd_);
            close(recordFd_);
            recordFd_ = -1;
        }
    }

    std::array<float, 3> recordingStats() const {
        return {
            recording_.load(std::memory_order_relaxed) ? 1.0f : 0.0f,
            static_cast<float>(recordedSamples_.load(std::memory_order_relaxed) / 2),
            static_cast<float>(recordDroppedFrames_.load(std::memory_order_relaxed))
        };
    }

    void setMasterGain(float gain) {
        masterGain_.store(std::clamp(gain, 0.0f, 1.5f));
    }

    void setCrossfader(float value) {
        crossfader_.store(std::clamp(value, -1.0f, 1.0f));
    }

    void setDeckTempo(int deck, float ratio) {
        if (!validDeck(deck)) return;
        const double safe = std::clamp(static_cast<double>(ratio), 0.5, 2.0);
        decks_[deck].tempoRatio.store(safe);
        for (auto& stem : stems_[deck]) stem.tempoRatio.store(safe);
    }

    void syncDeck(int deck, int master, float sourceBpm, float targetBpm) {
        if (!validDeck(deck) || !validDeck(master) || sourceBpm <= 0.0f || targetBpm <= 0.0f) return;
        setDeckTempo(deck, targetBpm / sourceBpm);

        auto masterClip = activeClipForDeck(master);
        auto sourceClip = activeClipForDeck(deck);
        if (!masterClip || !sourceClip) return;

        const double masterPos = activePositionForDeck(master);
        const double sourcePos = activePositionForDeck(deck);
        const double masterSeconds = masterPos / static_cast<double>(masterClip->sampleRate);
        const double sourceSeconds = sourcePos / static_cast<double>(sourceClip->sampleRate);
        const double beatSeconds = 60.0 / static_cast<double>(targetBpm);
        const double phase = std::fmod(std::max(0.0, masterSeconds), beatSeconds);
        const double beatBase = std::floor(std::max(0.0, sourceSeconds) / beatSeconds) * beatSeconds;
        const double alignedSeconds = std::max(0.0, beatBase + phase);

        setDeckPositionSeconds(deck, alignedSeconds);
    }

    void setStemGain(int deck, int stem, float gain) {
        if (!validDeck(deck) || stem < 0 || stem >= kStemCount) return;
        stems_[deck][stem].gain.store(std::clamp(gain, 0.0f, 1.5f));
    }

    void triggerPad(int pad, float gain) {
        if (pad < 0 || pad >= kPadCount) return;
        auto& state = pads_[pad];
        if (!std::atomic_load_explicit(&state.clip, std::memory_order_acquire)) return;
        state.gain.store(std::clamp(gain, 0.0f, 1.5f));
        state.positionFrames.store(0.0);
        state.playing.store(true);
    }

    void triggerFx(int mode, float amount) {
        if (mode < 1 || mode > 3) return;
        fxAmount_.store(std::clamp(amount, 0.0f, 1.0f));
        fxMode_.store(mode);
        int64_t frames = sampleRate_;
        if (mode == 1) frames = static_cast<int64_t>(sampleRate_ * 2.0);
        if (mode == 2) frames = static_cast<int64_t>(sampleRate_ * 0.5);
        if (mode == 3) frames = static_cast<int64_t>(sampleRate_ * 1.2);
        fxTotalFrames_.store(frames);
        fxFramesRemaining_.store(frames);
    }

    void setLimiterEnabled(bool enabled) {
        limiterEnabled_.store(enabled);
    }

    std::array<float, 4> meters() const {
        float xruns = 0.0f;
        if (stream_ != nullptr) {
            const int32_t count = AAudioStream_getXRunCount(stream_);
            xruns = static_cast<float>(std::max(0, count));
        }
        return {
            peakLeft_.load(std::memory_order_relaxed),
            peakRight_.load(std::memory_order_relaxed),
            running_.load(std::memory_order_relaxed) ? 1.0f : 0.0f,
            xruns
        };
    }

private:
    static void writeLe16(uint8_t* p, uint16_t v) {
        p[0] = static_cast<uint8_t>(v & 0xFF);
        p[1] = static_cast<uint8_t>((v >> 8) & 0xFF);
    }

    static void writeLe32(uint8_t* p, uint32_t v) {
        p[0] = static_cast<uint8_t>(v & 0xFF);
        p[1] = static_cast<uint8_t>((v >> 8) & 0xFF);
        p[2] = static_cast<uint8_t>((v >> 16) & 0xFF);
        p[3] = static_cast<uint8_t>((v >> 24) & 0xFF);
    }

    void writeWavHeader(int fd, uint32_t dataBytes) const {
        if (fd < 0) return;
        std::array<uint8_t, 44> h{};
        std::memcpy(h.data(), "RIFF", 4);
        writeLe32(h.data() + 4, 36u + dataBytes);
        std::memcpy(h.data() + 8, "WAVEfmt ", 8);
        writeLe32(h.data() + 16, 16);
        writeLe16(h.data() + 20, 1);
        writeLe16(h.data() + 22, 2);
        writeLe32(h.data() + 24, static_cast<uint32_t>(sampleRate_));
        writeLe32(h.data() + 28, static_cast<uint32_t>(sampleRate_ * 4));
        writeLe16(h.data() + 32, 4);
        writeLe16(h.data() + 34, 16);
        std::memcpy(h.data() + 36, "data", 4);
        writeLe32(h.data() + 40, dataBytes);
        pwrite(fd, h.data(), h.size(), 0);
        lseek(fd, 44, SEEK_SET);
    }

    void enqueueRecording(float left, float right) {
        if (!recording_.load(std::memory_order_relaxed) || recordRing_.size() < 4) return;
        const size_t size = recordRing_.size();
        const size_t w = recordWrite_.load(std::memory_order_relaxed);
        const size_t r = recordRead_.load(std::memory_order_acquire);
        const size_t used = w >= r ? (w - r) : (size - r + w);
        const size_t free = size - used - 1;
        if (free < 2) {
            recordDroppedFrames_.fetch_add(1, std::memory_order_relaxed);
            return;
        }

        const auto toPcm16 = [](float v) -> int16_t {
            const float clamped = std::clamp(v, -1.0f, 1.0f);
            return static_cast<int16_t>(std::lrint(clamped * 32767.0f));
        };

        recordRing_[w] = toPcm16(left);
        recordRing_[(w + 1) % size] = toPcm16(right);
        recordWrite_.store((w + 2) % size, std::memory_order_release);
    }

    void recordWriterLoop() {
        while (recording_.load(std::memory_order_acquire) ||
               recordRead_.load(std::memory_order_acquire) != recordWrite_.load(std::memory_order_acquire)) {
            if (recordFd_ < 0) break;
            const size_t size = recordRing_.size();
            const size_t r = recordRead_.load(std::memory_order_relaxed);
            const size_t w = recordWrite_.load(std::memory_order_acquire);
            if (r == w) {
                std::this_thread::sleep_for(std::chrono::milliseconds(4));
                continue;
            }

            const size_t count = w > r ? (w - r) : (size - r);
            const ssize_t bytes = write(
                recordFd_,
                recordRing_.data() + r,
                count * sizeof(int16_t)
            );
            if (bytes <= 0) {
                std::this_thread::sleep_for(std::chrono::milliseconds(4));
                continue;
            }

            const size_t samples = static_cast<size_t>(bytes) / sizeof(int16_t);
            recordRead_.store((r + samples) % size, std::memory_order_release);
            recordedSamples_.fetch_add(samples, std::memory_order_relaxed);
        }
    }

    void applyLoop(int deck) {
        if (!validDeck(deck) || !loopEnabled_[deck].load(std::memory_order_relaxed)) return;
        const double end = loopEndSeconds_[deck].load(std::memory_order_relaxed);
        if (deckPositionSeconds(deck) >= end) {
            setDeckPositionSeconds(deck, loopStartSeconds_[deck].load(std::memory_order_relaxed));
        }
    }

    static bool validDeck(int deck) {
        return deck >= 0 && deck < kDeckCount;
    }

    std::shared_ptr<const AudioClip> activeClipForDeck(int deck) const {
        if (deckUsesStems_[deck].load()) {
            for (const auto& stem : stems_[deck]) {
                auto clip = std::atomic_load_explicit(&stem.clip, std::memory_order_acquire);
                if (clip) return clip;
            }
        }
        return std::atomic_load_explicit(&decks_[deck].clip, std::memory_order_acquire);
    }

    double activePositionForDeck(int deck) const {
        if (deckUsesStems_[deck].load()) {
            for (const auto& stem : stems_[deck]) {
                if (std::atomic_load_explicit(&stem.clip, std::memory_order_acquire)) {
                    return stem.positionFrames.load();
                }
            }
        }
        return decks_[deck].positionFrames.load();
    }

    void setDeckPositionSeconds(int deck, double seconds) {
        auto base = std::atomic_load_explicit(&decks_[deck].clip, std::memory_order_acquire);
        if (base) decks_[deck].positionFrames.store(seconds * base->sampleRate);
        for (auto& stem : stems_[deck]) {
            auto clip = std::atomic_load_explicit(&stem.clip, std::memory_order_acquire);
            if (clip) stem.positionFrames.store(seconds * clip->sampleRate);
        }
    }

    void renderStream(StreamState& state, float& left, float& right) {
        if (!state.playing.load(std::memory_order_relaxed)) return;
        auto clip = std::atomic_load_explicit(&state.clip, std::memory_order_acquire);
        if (!clip || clip->frameCount() <= 0) {
            state.playing.store(false);
            return;
        }

        double pos = state.positionFrames.load(std::memory_order_relaxed);
        if (pos < 0.0 || pos >= static_cast<double>(clip->frameCount())) {
            state.playing.store(false);
            return;
        }

        const int64_t i0 = static_cast<int64_t>(pos);
        const int64_t i1 = std::min<int64_t>(i0 + 1, clip->frameCount() - 1);
        const float frac = static_cast<float>(pos - static_cast<double>(i0));

        auto sampleAt = [&](int64_t frame, int channel) {
            const int ch = clip->channels == 1 ? 0 : std::min(channel, clip->channels - 1);
            return clip->samples[static_cast<size_t>(frame * clip->channels + ch)];
        };

        const float l0 = sampleAt(i0, 0);
        const float l1 = sampleAt(i1, 0);
        const float r0 = sampleAt(i0, 1);
        const float r1 = sampleAt(i1, 1);
        const float gain = state.gain.load(std::memory_order_relaxed);

        left += (l0 + (l1 - l0) * frac) * gain;
        right += (r0 + (r1 - r0) * frac) * gain;

        const double sourcePerOutputFrame =
            (static_cast<double>(clip->sampleRate) / static_cast<double>(sampleRate_)) *
            state.tempoRatio.load(std::memory_order_relaxed);
        pos += sourcePerOutputFrame;
        state.positionFrames.store(pos, std::memory_order_relaxed);

        if (pos >= static_cast<double>(clip->frameCount())) {
            state.playing.store(false);
        }
    }

    void renderDeck(int deck, float& left, float& right) {
        if (deckUsesStems_[deck].load(std::memory_order_relaxed)) {
            for (auto& stem : stems_[deck]) renderStream(stem, left, right);
        } else {
            renderStream(decks_[deck], left, right);
        }
        applyLoop(deck);
    }

    void applyFx(float& left, float& right) {
        int mode = fxMode_.load(std::memory_order_relaxed);
        int64_t remaining = fxFramesRemaining_.load(std::memory_order_relaxed);
        if (mode == 0 || remaining <= 0) {
            fxMode_.store(0, std::memory_order_relaxed);
            return;
        }

        const float amount = fxAmount_.load(std::memory_order_relaxed);
        const int64_t total = std::max<int64_t>(1, fxTotalFrames_.load(std::memory_order_relaxed));

        if (mode == 1) {
            const float alpha = 0.025f + (1.0f - amount) * 0.30f;
            lowpassLeft_ += alpha * (left - lowpassLeft_);
            lowpassRight_ += alpha * (right - lowpassRight_);
            left = left * (1.0f - amount * 0.75f) + lowpassLeft_ * amount * 0.75f;
            right = right * (1.0f - amount * 0.75f) + lowpassRight_ * amount * 0.75f;
        } else if (mode == 2) {
            if (remaining > static_cast<int64_t>(total * 0.72)) {
                const float cut = 1.0f - amount;
                left *= cut;
                right *= cut;
            }
        }

        const size_t delaySize = delayLeft_.size();
        if (delaySize > 0 && (mode == 1 || mode == 3)) {
            const size_t delayFrames = mode == 3
                ? static_cast<size_t>(sampleRate_ * 0.06)
                : static_cast<size_t>(sampleRate_ * 0.25);
            const size_t readIndex =
                (delayWriteIndex_ + delaySize - std::min(delayFrames, delaySize - 1)) % delaySize;
            const float dl = delayLeft_[readIndex];
            const float dr = delayRight_[readIndex];
            const float feedback = mode == 3 ? 0.62f * amount : 0.38f * amount;
            delayLeft_[delayWriteIndex_] = std::clamp(left + dl * feedback, -1.5f, 1.5f);
            delayRight_[delayWriteIndex_] = std::clamp(right + dr * feedback, -1.5f, 1.5f);
            const float wet = mode == 3 ? 0.72f * amount : 0.30f * amount;
            left = left * (1.0f - wet) + dl * wet;
            right = right * (1.0f - wet) + dr * wet;
            delayWriteIndex_ = (delayWriteIndex_ + 1) % delaySize;
        }

        --remaining;
        fxFramesRemaining_.store(remaining, std::memory_order_relaxed);
        if (remaining <= 0) fxMode_.store(0, std::memory_order_relaxed);
    }

    static aaudio_data_callback_result_t dataCallback(
        AAudioStream*,
        void* userData,
        void* audioData,
        int32_t numFrames
    ) {
        auto* engine = static_cast<LiveAudioEngine*>(userData);
        auto* output = static_cast<float*>(audioData);

        const float cross = engine->crossfader_.load(std::memory_order_relaxed);
        const double angle = (static_cast<double>(cross) + 1.0) * kPi / 4.0;
        const float gainA = static_cast<float>(std::cos(angle));
        const float gainB = static_cast<float>(std::sin(angle));
        const float master = engine->masterGain_.load(std::memory_order_relaxed);
        float peakL = 0.0f;
        float peakR = 0.0f;

        for (int32_t frame = 0; frame < numFrames; ++frame) {
            float aL = 0.0f, aR = 0.0f, bL = 0.0f, bR = 0.0f;
            engine->renderDeck(0, aL, aR);
            engine->renderDeck(1, bL, bR);

            float left = aL * gainA + bL * gainB;
            float right = aR * gainA + bR * gainB;

            for (auto& pad : engine->pads_) {
                engine->renderStream(pad, left, right);
            }

            left *= master;
            right *= master;
            engine->applyFx(left, right);

            if (engine->limiterEnabled_.load(std::memory_order_relaxed)) {
                constexpr float drive = 1.25f;
                constexpr float norm = 0.84828364f;
                left = std::tanh(left * drive) / norm;
                right = std::tanh(right * drive) / norm;
            } else {
                left = std::clamp(left, -1.0f, 1.0f);
                right = std::clamp(right, -1.0f, 1.0f);
            }

            engine->enqueueRecording(left, right);

            peakL = std::max(peakL, std::fabs(left));
            peakR = std::max(peakR, std::fabs(right));

            if (engine->channelCount_ == 1) {
                output[frame] = (left + right) * 0.5f;
            } else {
                const int32_t base = frame * engine->channelCount_;
                output[base] = left;
                output[base + 1] = right;
                for (int32_t ch = 2; ch < engine->channelCount_; ++ch) {
                    output[base + ch] = 0.0f;
                }
            }
        }

        engine->peakLeft_.store(peakL, std::memory_order_relaxed);
        engine->peakRight_.store(peakR, std::memory_order_relaxed);
        return AAUDIO_CALLBACK_RESULT_CONTINUE;
    }

    static void errorCallback(AAudioStream*, void* userData, aaudio_result_t) {
        auto* engine = static_cast<LiveAudioEngine*>(userData);
        engine->running_.store(false, std::memory_order_release);
    }

    int32_t sampleRate_;
    int32_t channelCount_;
    AAudioStream* stream_ = nullptr;

    std::array<StreamState, kDeckCount> decks_{};
    std::array<std::array<StreamState, kStemCount>, kDeckCount> stems_{};
    std::array<StreamState, kPadCount> pads_{};
    std::array<std::atomic<bool>, kDeckCount> deckUsesStems_{{false, false}};

    std::atomic<float> masterGain_{1.0f};
    std::atomic<float> crossfader_{0.0f};
    std::atomic<bool> limiterEnabled_{true};
    std::atomic<bool> running_{false};

    std::atomic<int> fxMode_{0};
    std::atomic<float> fxAmount_{0.0f};
    std::atomic<int64_t> fxFramesRemaining_{0};
    std::atomic<int64_t> fxTotalFrames_{0};
    std::vector<float> delayLeft_;
    std::vector<float> delayRight_;
    size_t delayWriteIndex_ = 0;
    float lowpassLeft_ = 0.0f;
    float lowpassRight_ = 0.0f;

    std::atomic<float> peakLeft_{0.0f};
    std::atomic<float> peakRight_{0.0f};

    std::array<std::array<std::atomic<double>, kHotCueCount>, kDeckCount> hotCueSeconds_{};
    std::array<std::atomic<double>, kDeckCount> loopStartSeconds_{};
    std::array<std::atomic<double>, kDeckCount> loopEndSeconds_{};
    std::array<std::atomic<bool>, kDeckCount> loopEnabled_{};

    std::vector<int16_t> recordRing_;
    std::atomic<size_t> recordRead_{0};
    std::atomic<size_t> recordWrite_{0};
    std::atomic<bool> recording_{false};
    std::atomic<uint64_t> recordDroppedFrames_{0};
    std::atomic<uint64_t> recordedSamples_{0};
    int recordFd_ = -1;
    std::thread recordThread_;
};

LiveAudioEngine* fromHandle(jlong handle) {
    return reinterpret_cast<LiveAudioEngine*>(static_cast<intptr_t>(handle));
}

} // namespace

extern "C" JNIEXPORT jboolean JNICALL
Java_com_liveaudioperformance_studio_NativeDspBridge_nativeProbe(JNIEnv*, jobject) {
    return JNI_TRUE;
}

extern "C" JNIEXPORT jlong JNICALL
Java_com_liveaudioperformance_studio_NativeDspBridge_nativeCreateEngine(
    JNIEnv*, jobject, jint sampleRate, jint channelCount
) {
    if (sampleRate <= 0 || channelCount <= 0 || channelCount > 8) return 0;
    auto engine = std::make_unique<LiveAudioEngine>(sampleRate, channelCount);
    return static_cast<jlong>(reinterpret_cast<intptr_t>(engine.release()));
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_liveaudioperformance_studio_NativeDspBridge_nativeStartEngine(
    JNIEnv*, jobject, jlong handle
) {
    auto* engine = fromHandle(handle);
    return engine != nullptr && engine->start() ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT void JNICALL
Java_com_liveaudioperformance_studio_NativeDspBridge_nativeStopEngine(
    JNIEnv*, jobject, jlong handle
) {
    if (auto* engine = fromHandle(handle)) engine->stop();
}

extern "C" JNIEXPORT void JNICALL
Java_com_liveaudioperformance_studio_NativeDspBridge_nativeDestroyEngine(
    JNIEnv*, jobject, jlong handle
) {
    delete fromHandle(handle);
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_liveaudioperformance_studio_NativeDspBridge_nativeLoadDeckWav(
    JNIEnv*, jobject, jlong handle, jint deck, jint fd, jlong offset, jlong length
) {
    auto* engine = fromHandle(handle);
    return engine && engine->loadDeck(deck, fd, offset, length) ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_liveaudioperformance_studio_NativeDspBridge_nativeLoadStemWav(
    JNIEnv*, jobject, jlong handle, jint deck, jint stem, jint fd, jlong offset, jlong length
) {
    auto* engine = fromHandle(handle);
    return engine && engine->loadStem(deck, stem, fd, offset, length) ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_liveaudioperformance_studio_NativeDspBridge_nativeLoadPadWav(
    JNIEnv*, jobject, jlong handle, jint pad, jint fd, jlong offset, jlong length
) {
    auto* engine = fromHandle(handle);
    return engine && engine->loadPad(pad, fd, offset, length) ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT void JNICALL
Java_com_liveaudioperformance_studio_NativeDspBridge_nativePlayDeck(
    JNIEnv*, jobject, jlong handle, jint deck
) {
    if (auto* engine = fromHandle(handle)) engine->playDeck(deck);
}

extern "C" JNIEXPORT void JNICALL
Java_com_liveaudioperformance_studio_NativeDspBridge_nativePauseDeck(
    JNIEnv*, jobject, jlong handle, jint deck
) {
    if (auto* engine = fromHandle(handle)) engine->pauseDeck(deck);
}

extern "C" JNIEXPORT void JNICALL
Java_com_liveaudioperformance_studio_NativeDspBridge_nativeCueDeck(
    JNIEnv*, jobject, jlong handle, jint deck
) {
    if (auto* engine = fromHandle(handle)) engine->cueDeck(deck);
}

extern "C" JNIEXPORT void JNICALL
Java_com_liveaudioperformance_studio_NativeDspBridge_nativeSetMasterGain(
    JNIEnv*, jobject, jlong handle, jfloat gain
) {
    if (auto* engine = fromHandle(handle)) engine->setMasterGain(gain);
}

extern "C" JNIEXPORT void JNICALL
Java_com_liveaudioperformance_studio_NativeDspBridge_nativeSetCrossfader(
    JNIEnv*, jobject, jlong handle, jfloat value
) {
    if (auto* engine = fromHandle(handle)) engine->setCrossfader(value);
}

extern "C" JNIEXPORT void JNICALL
Java_com_liveaudioperformance_studio_NativeDspBridge_nativeSetDeckTempo(
    JNIEnv*, jobject, jlong handle, jint deck, jfloat ratio
) {
    if (auto* engine = fromHandle(handle)) engine->setDeckTempo(deck, ratio);
}

extern "C" JNIEXPORT void JNICALL
Java_com_liveaudioperformance_studio_NativeDspBridge_nativeSyncDeck(
    JNIEnv*, jobject, jlong handle, jint deck, jint masterDeck, jfloat sourceBpm, jfloat targetBpm
) {
    if (auto* engine = fromHandle(handle)) engine->syncDeck(deck, masterDeck, sourceBpm, targetBpm);
}

extern "C" JNIEXPORT void JNICALL
Java_com_liveaudioperformance_studio_NativeDspBridge_nativeSetStemGain(
    JNIEnv*, jobject, jlong handle, jint deck, jint stem, jfloat gain
) {
    if (auto* engine = fromHandle(handle)) engine->setStemGain(deck, stem, gain);
}

extern "C" JNIEXPORT void JNICALL
Java_com_liveaudioperformance_studio_NativeDspBridge_nativeTriggerPad(
    JNIEnv*, jobject, jlong handle, jint pad, jfloat gain
) {
    if (auto* engine = fromHandle(handle)) engine->triggerPad(pad, gain);
}

extern "C" JNIEXPORT void JNICALL
Java_com_liveaudioperformance_studio_NativeDspBridge_nativeTriggerFx(
    JNIEnv*, jobject, jlong handle, jint mode, jfloat amount
) {
    if (auto* engine = fromHandle(handle)) engine->triggerFx(mode, amount);
}

extern "C" JNIEXPORT void JNICALL
Java_com_liveaudioperformance_studio_NativeDspBridge_nativeSetLimiterEnabled(
    JNIEnv*, jobject, jlong handle, jboolean enabled
) {
    if (auto* engine = fromHandle(handle)) engine->setLimiterEnabled(enabled == JNI_TRUE);
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_liveaudioperformance_studio_NativeDspBridge_nativeSetHotCue(
    JNIEnv*, jobject, jlong handle, jint deck, jint slot
) {
    auto* engine = fromHandle(handle);
    return engine && engine->setHotCue(deck, slot) ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_liveaudioperformance_studio_NativeDspBridge_nativeJumpHotCue(
    JNIEnv*, jobject, jlong handle, jint deck, jint slot
) {
    auto* engine = fromHandle(handle);
    return engine && engine->jumpHotCue(deck, slot) ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT void JNICALL
Java_com_liveaudioperformance_studio_NativeDspBridge_nativeClearHotCue(
    JNIEnv*, jobject, jlong handle, jint deck, jint slot
) {
    if (auto* engine = fromHandle(handle)) engine->clearHotCue(deck, slot);
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_liveaudioperformance_studio_NativeDspBridge_nativeSetBeatLoop(
    JNIEnv*, jobject, jlong handle, jint deck, jint beats, jfloat bpm
) {
    auto* engine = fromHandle(handle);
    return engine && engine->setBeatLoop(deck, beats, bpm) ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT void JNICALL
Java_com_liveaudioperformance_studio_NativeDspBridge_nativeClearLoop(
    JNIEnv*, jobject, jlong handle, jint deck
) {
    if (auto* engine = fromHandle(handle)) engine->clearLoop(deck);
}

extern "C" JNIEXPORT jdouble JNICALL
Java_com_liveaudioperformance_studio_NativeDspBridge_nativeDeckPositionSeconds(
    JNIEnv*, jobject, jlong handle, jint deck
) {
    if (auto* engine = fromHandle(handle)) return engine->deckPositionSeconds(deck);
    return -1.0;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_liveaudioperformance_studio_NativeDspBridge_nativeSeekDeckSeconds(
    JNIEnv*, jobject, jlong handle, jint deck, jdouble seconds
) {
    auto* engine = fromHandle(handle);
    return engine && engine->seekDeckSeconds(deck, seconds) ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_liveaudioperformance_studio_NativeDspBridge_nativeStartRecording(
    JNIEnv*, jobject, jlong handle, jint fd
) {
    auto* engine = fromHandle(handle);
    return engine && engine->startRecording(fd) ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT void JNICALL
Java_com_liveaudioperformance_studio_NativeDspBridge_nativeStopRecording(
    JNIEnv*, jobject, jlong handle
) {
    if (auto* engine = fromHandle(handle)) engine->stopRecording();
}

extern "C" JNIEXPORT jfloatArray JNICALL
Java_com_liveaudioperformance_studio_NativeDspBridge_nativeGetRecordingStats(
    JNIEnv* env, jobject, jlong handle
) {
    jfloatArray result = env->NewFloatArray(3);
    if (!result) return nullptr;
    std::array<float, 3> values{0.0f, 0.0f, 0.0f};
    if (auto* engine = fromHandle(handle)) values = engine->recordingStats();
    env->SetFloatArrayRegion(result, 0, 3, values.data());
    return result;
}

extern "C" JNIEXPORT jfloatArray JNICALL
Java_com_liveaudioperformance_studio_NativeDspBridge_nativeGetMeters(
    JNIEnv* env, jobject, jlong handle
) {
    jfloatArray result = env->NewFloatArray(4);
    if (!result) return nullptr;
    std::array<float, 4> values{0.0f, 0.0f, 0.0f, 0.0f};
    if (auto* engine = fromHandle(handle)) values = engine->meters();
    env->SetFloatArrayRegion(result, 0, 4, values.data());
    return result;
}
