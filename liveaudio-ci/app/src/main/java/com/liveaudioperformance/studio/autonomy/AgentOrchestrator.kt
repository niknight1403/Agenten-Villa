package com.liveaudioperformance.studio.autonomy

class AgentOrchestrator {
    data class ToolResult(val success: Boolean, val message: String, val data: Map<String, String> = emptyMap())

    fun interface Tool {
        fun execute(input: Map<String, String>): ToolResult
    }

    data class Skill(val id: String, val description: String, val requiredTools: Set<String>)
    data class Connector(val id: String, val enabled: Boolean, val localFirst: Boolean, val description: String)

    private val tools = linkedMapOf<String, Tool>()
    private val skills = linkedMapOf<String, Skill>()
    private val connectors = linkedMapOf<String, Connector>()

    fun registerTool(id: String, tool: Tool) {
        require(id.isNotBlank())
        tools[id] = tool
    }

    fun registerSkill(skill: Skill) {
        require(skill.requiredTools.all { tools.containsKey(it) })
        skills[skill.id] = skill
    }

    fun registerConnector(connector: Connector) {
        connectors[connector.id] = connector
    }

    fun executeTool(id: String, input: Map<String, String> = emptyMap()): ToolResult =
        tools[id]?.execute(input) ?: ToolResult(false, "tool-not-found:" + id)

    fun canRunSkill(id: String): Boolean =
        skills[id]?.requiredTools?.all { tools.containsKey(it) } == true

    fun enabledConnectors(): List<Connector> = connectors.values.filter { it.enabled }

    companion object {
        fun productionDefaults(): AgentOrchestrator = AgentOrchestrator().apply {
            registerTool("analyze-project") { ToolResult(true, "project-analysis-ready") }
            registerTool("inspect-audio-health") { ToolResult(true, "audio-health-ready") }
            registerTool("plan-performance") { ToolResult(true, "performance-plan-ready") }
            registerTool("run-release-gate") { ToolResult(true, "release-gate-ready") }
            registerSkill(Skill("performance-copilot", "Analyze and prepare a live performance.", setOf("inspect-audio-health", "plan-performance")))
            registerSkill(Skill("release-guardian", "Validate release readiness.", setOf("analyze-project", "run-release-gate")))
            registerConnector(Connector("local-files", true, true, "Android Storage Access Framework"))
            registerConnector(Connector("native-audio", true, true, "JNI/AAudio DSP bridge"))
            registerConnector(Connector("optional-cloud-ai", false, false, "Explicit opt-in external AI endpoint"))
        }
    }
}
