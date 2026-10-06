import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  faultRegistry,
  withFaults,
  createFaultInjectedProvider,
  createFaultInjectedDatabase,
  buildInjectedError,
  PersistenceError,
  ProviderTimeoutError,
  ProviderRateLimitError,
  ProviderAuthError,
  ProviderUnavailableError,
  ProviderRejectedError,
  ProviderContextTooLargeError,
  ProviderStoppedError,
  ProviderInvalidResponseError,
  ProviderInvalidInputError,
  ProviderMissingKeyError,
  ProviderPinUnavailableError,
} from "./fault-injection";
import { AgentError, safeAgentError } from "./agent-engine";
import {
  AGENT_ERROR_CODES,
  categoryForError,
  publicMessageForError,
} from "./error-codes";
import { probeDatabaseConnection } from "./db-health";

describe("Sprint 086 — Fehler-Injection Harness & Regressionstests", () => {
  beforeEach(() => {
    faultRegistry.clear();
    faultRegistry.resetStats();
  });

  afterEach(() => {
    faultRegistry.clear();
    faultRegistry.resetStats();
  });

  describe("Harness Core & Registratur", () => {
    it("schaltet Regeln korrekt ein, aus und erfasst Statistiken", async () => {
      expect(faultRegistry.isActive()).toBe(false);

      faultRegistry.setRules({
        target: "provider",
        code: "TIMEOUT",
        message: "Test Timeout",
      });

      expect(faultRegistry.isActive()).toBe(true);

      const mockProvider = createFaultInjectedProvider();
      await expect(mockProvider("Hallo")).rejects.toThrow(ProviderTimeoutError);

      const stats = faultRegistry.getStats();
      expect(stats.totalInjected).toBe(1);
      expect(stats.byTarget.provider).toBe(1);
      expect(stats.byCode.TIMEOUT).toBe(1);
    });

    it("respektiert maxTriggers für vorübergehende Fehler und spätere Erholung", async () => {
      faultRegistry.setRules({
        target: "provider",
        code: "UNAVAILABLE",
        maxTriggers: 2,
      });

      const mockProvider = createFaultInjectedProvider(async () => "Erfolg");

      // Läufe 1 und 2 werfen Fehler
      await expect(mockProvider("1")).rejects.toThrow(ProviderUnavailableError);
      await expect(mockProvider("2")).rejects.toThrow(ProviderUnavailableError);

      // Lauf 3 erholt sich
      const result = await mockProvider("3");
      expect(result).toBe("Erfolg");

      expect(faultRegistry.getStats().totalInjected).toBe(2);
    });

    it("isoliert Regeln mit withFaults() zuverlässig", async () => {
      expect(faultRegistry.isActive()).toBe(false);

      const res = await withFaults(
        { target: "database", code: "DATABASE_UNAVAILABLE" },
        async () => {
          expect(faultRegistry.isActive()).toBe(true);
          const mockDb = createFaultInjectedDatabase();
          await expect(mockDb.execute("SELECT 1")).rejects.toThrow(PersistenceError);
          return "scoped_ok";
        }
      );

      expect(res).toBe("scoped_ok");
      expect(faultRegistry.isActive()).toBe(false);
    });
  });

  describe("Mindestens 1 Regressionstest pro Fehlerklasse", () => {
    // 1. TIMEOUT (Timeout-Fehler)
    it("1. Regressionstest für TIMEOUT (ProviderTimeoutError)", async () => {
      const err = buildInjectedError("TIMEOUT", "Simulierter Provider-Timeout", 30);
      expect(err).toBeInstanceOf(ProviderTimeoutError);
      expect(err.code).toBe("TIMEOUT");
      expect(err.status).toBe(504);
      expect(err.retryAfterSeconds).toBe(30);
      expect(categoryForError(err.code)).toBe("provider");
      expect(publicMessageForError(err.code)).toBe(
        "Der Anbieter konnte die Anfrage gerade nicht verarbeiten."
      );
      expect(safeAgentError(err)).toBe("Simulierter Provider-Timeout");
    });

    // 2. LIMIT (Rate-Limit-Fehler)
    it("2. Regressionstest für LIMIT (ProviderRateLimitError)", async () => {
      const err = buildInjectedError("LIMIT", "Simuliertes Rate-Limit", 120);
      expect(err).toBeInstanceOf(ProviderRateLimitError);
      expect(err.code).toBe("LIMIT");
      expect(err.status).toBe(429);
      expect(err.retryAfterSeconds).toBe(120);
      expect(categoryForError(err.code)).toBe("quota");
      expect(publicMessageForError(err.code)).toBe("Das verfügbare Kontingent wurde erreicht.");
      expect(safeAgentError(err)).toBe("Simuliertes Rate-Limit");
    });

    // 3. AUTH (Authentifizierungsfehler)
    it("3. Regressionstest für AUTH (ProviderAuthError)", async () => {
      const err = buildInjectedError("AUTH", "Ungültiger API-Key");
      expect(err).toBeInstanceOf(ProviderAuthError);
      expect(err.code).toBe("AUTH");
      expect(err.status).toBe(401);
      expect(categoryForError(err.code)).toBe("authorization");
      expect(publicMessageForError(err.code)).toBe("Die Anfrage ist nicht autorisiert.");
    });

    // 4. UNAVAILABLE (Anbieter-Verfügbarkeitsfehler)
    it("4. Regressionstest für UNAVAILABLE (ProviderUnavailableError)", async () => {
      const err = buildInjectedError("UNAVAILABLE", "Anbieter 503 Overloaded");
      expect(err).toBeInstanceOf(ProviderUnavailableError);
      expect(err.code).toBe("UNAVAILABLE");
      expect(err.status).toBe(503);
      expect(categoryForError(err.code)).toBe("provider");
      expect(publicMessageForError(err.code)).toBe(
        "Der Anbieter konnte die Anfrage gerade nicht verarbeiten."
      );
    });

    // 5. REJECTED (Inhaltliche Ablehnung)
    it("5. Regressionstest für REJECTED (ProviderRejectedError)", async () => {
      const err = buildInjectedError("REJECTED", "Sicherheitsfilter getriggert");
      expect(err).toBeInstanceOf(ProviderRejectedError);
      expect(err.code).toBe("REJECTED");
      expect(err.status).toBe(400);
      expect(categoryForError(err.code)).toBe("provider");
    });

    // 6. CONTEXT_TOO_LARGE (Kontextfenster-Überschreitung)
    it("6. Regressionstest für CONTEXT_TOO_LARGE (ProviderContextTooLargeError)", async () => {
      const err = buildInjectedError("CONTEXT_TOO_LARGE", "Prompt zu lang für Modell");
      expect(err).toBeInstanceOf(ProviderContextTooLargeError);
      expect(err.code).toBe("CONTEXT_TOO_LARGE");
      expect(err.status).toBe(400);
      expect(categoryForError(err.code)).toBe("capacity");
      expect(publicMessageForError(err.code)).toBe(
        "Die Anfrage überschreitet das Kontextfenster des Modells."
      );
    });

    // 7. STOPPED (Manuell gestoppter Lauf)
    it("7. Regressionstest für STOPPED (ProviderStoppedError)", async () => {
      const err = buildInjectedError("STOPPED", "Lauf durch Nutzer gestoppt");
      expect(err).toBeInstanceOf(ProviderStoppedError);
      expect(err.code).toBe("STOPPED");
      expect(err.status).toBe(400);
      expect(categoryForError(err.code)).toBe("control");
      expect(publicMessageForError(err.code)).toBe("Der Agent ist aktuell gestoppt.");
    });

    // 8. INVALID_RESPONSE (Ungültiges Provider-Format)
    it("8. Regressionstest für INVALID_RESPONSE (ProviderInvalidResponseError)", async () => {
      const err = buildInjectedError("INVALID_RESPONSE", "Leere oder defekte JSON-Antwort");
      expect(err).toBeInstanceOf(ProviderInvalidResponseError);
      expect(err.code).toBe("INVALID_RESPONSE");
      expect(err.status).toBe(502);
      expect(categoryForError(err.code)).toBe("validation");
      expect(publicMessageForError(err.code)).toBe(
        "Die Antwort konnte nicht sicher validiert werden."
      );
    });

    // 9. INVALID_INPUT (Validierungsfehler der Eingabe)
    it("9. Regressionstest für INVALID_INPUT (ProviderInvalidInputError)", async () => {
      const err = buildInjectedError("INVALID_INPUT", "Ungültiger Parameterwert");
      expect(err).toBeInstanceOf(ProviderInvalidInputError);
      expect(err.code).toBe("INVALID_INPUT");
      expect(err.status).toBe(400);
      expect(categoryForError(err.code)).toBe("validation");
    });

    // 10. MISSING_KEY (Fehlende Konfiguration)
    it("10. Regressionstest für MISSING_KEY (ProviderMissingKeyError)", async () => {
      const err = buildInjectedError("MISSING_KEY", "Schlüssel nicht in Env");
      expect(err).toBeInstanceOf(ProviderMissingKeyError);
      expect(err.code).toBe("MISSING_KEY");
      expect(err.status).toBe(400);
      expect(categoryForError(err.code)).toBe("configuration");
      expect(publicMessageForError(err.code)).toBe(
        "Die benötigte Konfiguration ist noch nicht eingerichtet."
      );
    });

    // 11. PIN_UNAVAILABLE (Admin-Pin auf nicht nutzbaren Anbieter)
    it("11. Regressionstest für PIN_UNAVAILABLE (ProviderPinUnavailableError)", async () => {
      const err = buildInjectedError("PIN_UNAVAILABLE", "Gepinnter Anbieter gesperrt");
      expect(err).toBeInstanceOf(ProviderPinUnavailableError);
      expect(err.code).toBe("PIN_UNAVAILABLE");
      expect(err.status).toBe(503);
      expect(categoryForError(err.code)).toBe("configuration");
    });

    // 12. DATABASE_UNAVAILABLE (Persistenzfehler: Keine DB-Verbindung)
    it("12. Regressionstest für DATABASE_UNAVAILABLE (PersistenceError)", async () => {
      const err = new PersistenceError("DATABASE_UNAVAILABLE", "Verbindung verweigert");
      expect(err).toBeInstanceOf(PersistenceError);
      expect(err.code).toBe("DATABASE_UNAVAILABLE");
      expect(err.message).toBe("Verbindung verweigert");

      const mockDb = createFaultInjectedDatabase();
      faultRegistry.setRules({ target: "database", code: "DATABASE_UNAVAILABLE" });

      const status = await probeDatabaseConnection(mockDb);
      expect(status).toBe("fehler");
    });

    // 13. PERSISTENCE_READ_FAILED (Persistenzfehler: Lese-Fehler)
    it("13. Regressionstest für PERSISTENCE_READ_FAILED", async () => {
      const err = new PersistenceError("PERSISTENCE_READ_FAILED", "Timeout beim Lesen aus DB");
      expect(err.code).toBe("PERSISTENCE_READ_FAILED");
      expect(err.name).toBe("PersistenceError");
    });

    // 14. PERSISTENCE_WRITE_FAILED (Persistenzfehler: Schreib-Fehler)
    it("14. Regressionstest für PERSISTENCE_WRITE_FAILED", async () => {
      const err = new PersistenceError("PERSISTENCE_WRITE_FAILED", "Constraint Violation");
      expect(err.code).toBe("PERSISTENCE_WRITE_FAILED");
      expect(err.name).toBe("PersistenceError");
    });

    // 15. LOCK_TIMEOUT (Persistenzfehler: Sperren-Timeout)
    it("15. Regressionstest für LOCK_TIMEOUT", async () => {
      const err = new PersistenceError("LOCK_TIMEOUT", "Row Lock Timeout nach 5000ms");
      expect(err.code).toBe("LOCK_TIMEOUT");
      expect(err.name).toBe("PersistenceError");
    });
  });

  describe("Spezifische Regressionstests für Timeout, Rate-Limit und Persistenz", () => {
    it("Timeout-Injection: verhält sich deterministisch und liefert sichere Fehlermeldung", async () => {
      await withFaults(
        {
          target: "provider",
          code: "TIMEOUT",
          delayMs: 10,
          message: "Anfrage-Zeitüberschreitung im Router",
        },
        async () => {
          const mockProvider = createFaultInjectedProvider();
          try {
            await mockProvider("Timeout Test");
            expect.unreachable("Sollte fehlschlagen");
          } catch (e) {
            expect(e).toBeInstanceOf(ProviderTimeoutError);
            const agentErr = e as AgentError;
            expect(agentErr.code).toBe("TIMEOUT");
            expect(safeAgentError(agentErr)).toBe("Anfrage-Zeitüberschreitung im Router");
          }
        }
      );
    });

    it("Rate-Limit-Injection: behält status=429 und retryAfterSeconds ohne Secret-Leaks", async () => {
      await withFaults(
        {
          target: "provider",
          code: "LIMIT",
          retryAfterSeconds: 300,
          message: "Rate limit hit: 429 Too Many Requests",
        },
        async () => {
          const mockProvider = createFaultInjectedProvider();
          try {
            await mockProvider("Rate Limit Test");
            expect.unreachable("Sollte fehlschlagen");
          } catch (e) {
            expect(e).toBeInstanceOf(ProviderRateLimitError);
            const agentErr = e as ProviderRateLimitError;
            expect(agentErr.status).toBe(429);
            expect(agentErr.retryAfterSeconds).toBe(300);
            expect(safeAgentError(agentErr)).toContain("Rate limit hit");
          }
        }
      );
    });

    it("Persistenzfehler-Injection: DB-Ausfall wird abgefangen und nicht als unkontrollierter Crash gewertet", async () => {
      await withFaults(
        {
          target: "database",
          code: "PERSISTENCE_WRITE_FAILED",
          message: "Künstlicher DB-Schreibfehler",
        },
        async () => {
          const mockDb = createFaultInjectedDatabase();
          try {
            await mockDb.execute("INSERT INTO runs ...");
            expect.unreachable("Sollte fehlschlagen");
          } catch (e) {
            expect(e).toBeInstanceOf(PersistenceError);
            expect((e as PersistenceError).code).toBe("PERSISTENCE_WRITE_FAILED");
          }
        }
      );
    });
  });

  describe("Vollständigkeitsprüfung der Sprint-008 Fehlercodes", () => {
    it("alle in AGENT_ERROR_CODES definierten Fehlercodes besitzen eine Fehlerkategorie", () => {
      for (const code of AGENT_ERROR_CODES) {
        const cat = categoryForError(code);
        expect(cat).toBeDefined();
        const msg = publicMessageForError(code);
        expect(msg).toBeDefined();
        expect(msg.length).toBeGreaterThan(0);
      }
    });
  });
});
