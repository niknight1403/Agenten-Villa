import { beforeAll, describe, expect, it } from "vitest";
import { generateKeyPair, SignJWT, exportJWK } from "jose";
import { verifyGoogleIdToken } from "./nativeAuth";

const AUDIENCE = "656137332727-2i47bqt2fk359nj48tc0kdfl3mhjmoo1.apps.googleusercontent.com";

let jwks: { keys: Record<string, unknown>[] };
let privateKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const publicJwk = await exportJWK(pair.publicKey);
  jwks = { keys: [{ ...publicJwk, kid: "test-key", use: "sig", alg: "RS256" }] };
});

async function mintToken(claims: Record<string, unknown>, kid = "test-key") {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid })
    .setIssuedAt()
    .setExpirationTime("2m")
    .sign(privateKey);
}

describe("verifyGoogleIdToken", () => {
  it("akzeptiert ein gueltiges Google-ID-Token und extrahiert das Profil", async () => {
    const token = await mintToken({
      iss: "https://accounts.google.com",
      aud: AUDIENCE,
      sub: "1234567890",
      email: "Niko.Oeben@Gmail.com",
      name: "Heinz-Nikola Oeben",
    });
    const profile = await verifyGoogleIdToken(token, { audience: AUDIENCE, jwks });
    expect(profile).toEqual({
      sub: "1234567890",
      email: "niko.oeben@gmail.com",
      name: "Heinz-Nikola Oeben",
    });
  });

  it("akzeptiert auch den issuer accounts.google.com (ohne https)", async () => {
    const token = await mintToken({
      iss: "accounts.google.com",
      aud: AUDIENCE,
      sub: "sub-2",
      email: "user@example.com",
      name: "User",
    });
    const profile = await verifyGoogleIdToken(token, { audience: AUDIENCE, jwks });
    expect(profile.sub).toBe("sub-2");
  });

  it("lehnt ein Token mit falscher audience ab", async () => {
    const token = await mintToken({
      iss: "https://accounts.google.com",
      aud: "anderer-client.apps.googleusercontent.com",
      sub: "sub-3",
    });
    await expect(
      verifyGoogleIdToken(token, { audience: AUDIENCE, jwks })
    ).rejects.toThrow();
  });

  it("lehnt ein Token mit falschem issuer ab", async () => {
    const token = await mintToken({
      iss: "https://evil.example.com",
      aud: AUDIENCE,
      sub: "sub-4",
    });
    await expect(
      verifyGoogleIdToken(token, { audience: AUDIENCE, jwks })
    ).rejects.toThrow();
  });

  it("lehnt ein abgelaufenes Token ab", async () => {
    const pair = await generateKeyPair("RS256");
    const expired = await new SignJWT({
      iss: "https://accounts.google.com",
      aud: AUDIENCE,
      sub: "sub-5",
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(pair.privateKey);
    const ownJwks = {
      keys: [{ ...(await exportJWK(pair.publicKey)), kid: "test-key", alg: "RS256" }],
    };
    await expect(
      verifyGoogleIdToken(expired, { audience: AUDIENCE, jwks: ownJwks })
    ).rejects.toThrow();
  });

  it("lehnt Muell ohne strukturierten JWT ab", async () => {
    await expect(
      verifyGoogleIdToken("kein-jwt", { audience: AUDIENCE, jwks })
    ).rejects.toThrow();
  });

  it("lehnt ein Token ohne sub ab", async () => {
    const token = await mintToken({
      iss: "https://accounts.google.com",
      aud: AUDIENCE,
    });
    await expect(
      verifyGoogleIdToken(token, { audience: AUDIENCE, jwks })
    ).rejects.toThrow("sub missing");
  });

  it("verlangt eine audience (Server-Misskonfiguration)", async () => {
    const token = await mintToken({
      iss: "https://accounts.google.com",
      aud: AUDIENCE,
      sub: "sub-6",
    });
    await expect(verifyGoogleIdToken(token, { audience: "" })).rejects.toThrow(
      "audience"
    );
  });
});
