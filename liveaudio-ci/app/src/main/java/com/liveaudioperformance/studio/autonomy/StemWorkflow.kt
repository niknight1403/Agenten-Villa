package com.liveaudioperformance.studio.autonomy

object StemWorkflow {
    enum class Stem { DRUMS, BASS, VOCALS, OTHER }
    enum class Backend { LOCAL_ON_DEVICE, LOCAL_DESKTOP, OPTIONAL_CLOUD }

    data class Capabilities(
        val onDeviceModelAvailable: Boolean,
        val desktopWorkerReachable: Boolean,
        val cloudEnabledByUser: Boolean,
    )

    data class Plan(
        val backend: Backend,
        val outputStems: Set<Stem>,
        val cacheLocally: Boolean,
        val requiresNetwork: Boolean,
        val reason: String,
    )

    fun chooseBackend(capabilities: Capabilities): Plan {
        val backend = when {
            capabilities.onDeviceModelAvailable -> Backend.LOCAL_ON_DEVICE
            capabilities.desktopWorkerReachable -> Backend.LOCAL_DESKTOP
            capabilities.cloudEnabledByUser -> Backend.OPTIONAL_CLOUD
            else -> Backend.LOCAL_ON_DEVICE
        }
        val available = capabilities.onDeviceModelAvailable ||
            capabilities.desktopWorkerReachable ||
            capabilities.cloudEnabledByUser
        return Plan(
            backend = backend,
            outputStems = Stem.entries.toSet(),
            cacheLocally = true,
            requiresNetwork = backend == Backend.OPTIONAL_CLOUD,
            reason = if (available) "best-available-backend" else "offline-model-required",
        )
    }
}
