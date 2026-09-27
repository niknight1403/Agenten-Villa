/**
 * Sprint 011: Datenbank-Health — reine Prueflogik und Health-Payload-Integration.
 */
import { describe, expect, it } from "vitest";
import { probeDatabaseConnection, type ExecutableDatabase } from "./db-health";
import {
  getDatabaseHealthReport,
  getHealthPayload,
  resetDatabaseCacheForTests,
  resetVersionCacheForTests,
  setDatabaseHealthReport,
} from "./_core/health";

function fakeDb(behavior: "ok" | "fail"): ExecutableDatabase {
  return {
    async execute(sql: string) {
      if (behavior === "fail") throw new Error("connection refused");
      return { sql };
    },
  };
}

describe("probeDatabaseConnection", () => {
  it("meldet nicht_konfiguriert ohne DB-Instanz", async () => {
    expect(await probeDatabaseConnection(null)).toBe("nicht_konfiguriert");
  });

  it("meldet verbunden bei erfolgreicher SELECT-1-Probe", async () => {
    expect(await probeDatabaseConnection(fakeDb("ok"))).toBe("verbunden");
  });

  it("meldet fehler bei abgewiesener Verbindung (kein Umgehen von 4xx/5xx)", async () => {
    expect(await probeDatabaseConnection(fakeDb("fail"))).toBe("fehler");
  });
});

describe("Health-Payload mit DB-Status", () => {
  it("enthaelt das database-Feld erst nach dem ersten Check", () => {
    resetVersionCacheForTests();
    resetDatabaseCacheForTests();
    expect(getHealthPayload().database).toBeUndefined();
    expect(getDatabaseHealthReport()).toBeNull();

    setDatabaseHealthReport({ status: "verbunden", checkedAt: "2026-09-27T08:00:00.000Z" });
    expect(getDatabaseHealthReport()?.status).toBe("verbunden");
    expect(getHealthPayload().database?.status).toBe("verbunden");
    expect(getHealthPayload().ok).toBe(true);

    resetDatabaseCacheForTests();
  });

  it("zeigt Fehler-Status durch (kein stilles Gruen)", () => {
    resetDatabaseCacheForTests();
    setDatabaseHealthReport({ status: "fehler", checkedAt: "2026-09-27T08:00:00.000Z" });
    expect(getHealthPayload().database?.status).toBe("fehler");
    resetDatabaseCacheForTests();
  });
});
