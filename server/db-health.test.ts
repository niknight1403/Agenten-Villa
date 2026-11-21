/**
 * Sprint 011: Datenbank-Health — Prueflogik und Health-Payload-Integration.
 */
import { describe, expect, it, vi } from "vitest";
import { SQL } from "drizzle-orm";
import { databaseErrorSummary, probeDatabaseConnection, type ExecutableDatabase } from "./db-health";
import {
  getDatabaseHealthReport,
  getHealthPayload,
  resetDatabaseCacheForTests,
  resetVersionCacheForTests,
  setDatabaseHealthReport,
} from "./_core/health";

function fakeDb(behavior: "ok" | "fail"): ExecutableDatabase {
  return {
    async execute(query) {
      if (behavior === "fail") throw new Error("connection refused");
      return { query };
    },
  };
}

describe("probeDatabaseConnection", () => {
  it("meldet nicht_konfiguriert ohne DB-Instanz", async () => {
    expect(await probeDatabaseConnection(null)).toBe("nicht_konfiguriert");
  });

  it("uebergibt ein Drizzle-SQL-Objekt und meldet verbunden", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] });
    const db: ExecutableDatabase = { execute };

    expect(await probeDatabaseConnection(db)).toBe("verbunden");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toBeInstanceOf(SQL);
  });

  it("meldet verbunden bei erfolgreicher SELECT-1-Probe", async () => {
    expect(await probeDatabaseConnection(fakeDb("ok"))).toBe("verbunden");
  });

  it("meldet fehler bei abgewiesener Verbindung und gibt eine Diagnose weiter", async () => {
    const onError = vi.fn();
    expect(await probeDatabaseConnection(fakeDb("fail"), onError)).toBe("fehler");
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("connection refused"));
  });

  it("fasst Datenbankfehler zusammen, ohne Zugangsdaten auszugeben", () => {
    const summary = databaseErrorSummary({
      name: "Error",
      code: "ECONNREFUSED",
      message: "connect postgres://admin:secret@db.example:5432/app password=hidden",
    });
    expect(summary).toContain("ECONNREFUSED");
    expect(summary).not.toContain("secret");
    expect(summary).not.toContain("hidden");
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
