import { describe, expect, it } from "vitest";
import { existsSync, statSync, readFileSync } from "node:fs";
import path from "node:path";

describe("release-check script", () => {
  const scriptPath = path.resolve(process.cwd(), "scripts/release-check.sh");
  const pkgPath = path.resolve(process.cwd(), "package.json");

  it("exists and is executable", () => {
    expect(existsSync(scriptPath)).toBe(true);
    const stats = statSync(scriptPath);
    // Check executable bit (mode & 0o111)
    const isExecutable = (stats.mode & 0o111) !== 0;
    expect(isExecutable).toBe(true);
  });

  it("contains check, test, build and summary logic", () => {
    const content = readFileSync(scriptPath, "utf-8");
    expect(content).toContain("pnpm check");
    expect(content).toContain("pnpm test");
    expect(content).toContain("pnpm build");
    expect(content).toContain("SUMMARY & RELEASE STATUS");
    expect(content).toContain("exit 0");
    expect(content).toContain("exit 1");
  });

  it("is registered in package.json as release:check", () => {
    const pkgRaw = readFileSync(pkgPath, "utf-8");
    const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.["release:check"]).toBe("bash scripts/release-check.sh");
  });
});
