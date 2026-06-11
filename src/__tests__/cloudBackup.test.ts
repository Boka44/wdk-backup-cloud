import { CloudBackup } from "../cloudBackup";
import {
  CloudAuthError,
  CloudStorageError,
  CloudUnavailableError,
  CloudValidationError,
} from "../errors";
import type { CloudEncryptionKeyFile, CloudProvider } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SAMPLE_PAYLOAD: CloudEncryptionKeyFile = {
  encryptionKey: "enc_key_abc123",
  savedAt: "2026-03-01T00:00:00.000Z",
  platform: "android",
  version: 1,
  cloudEmail: "",
};

function makeProvider(
  overrides: Partial<CloudProvider> = {},
): jest.Mocked<CloudProvider> {
  return {
    upload: jest
      .fn<Promise<CloudEncryptionKeyFile | null>, [string, Record<string, unknown>]>()
      .mockResolvedValue(SAMPLE_PAYLOAD),
    download: jest
      .fn<Promise<CloudEncryptionKeyFile | null>, []>()
      .mockResolvedValue(null),
    delete: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    isAvailable: jest.fn<Promise<boolean>, []>().mockResolvedValue(true),
    exists: jest.fn<Promise<boolean>, []>().mockResolvedValue(false),
    ...overrides,
  } as jest.Mocked<CloudProvider>;
}

// ---------------------------------------------------------------------------
// uploadEncryptedKey
// ---------------------------------------------------------------------------

describe("CloudBackup.uploadEncryptedKey", () => {
  it("calls provider.upload with the correct key and metadata", async () => {
    const provider = makeProvider();
    const backup = new CloudBackup(provider);
    await backup.uploadEncryptedKey("enc_key_abc123", { version: 1 });
    expect(provider.upload).toHaveBeenCalledTimes(1);
    expect(provider.upload).toHaveBeenCalledWith("enc_key_abc123", {
      version: 1,
    });
  });

  it("throws CloudValidationError for empty string", async () => {
    const provider = makeProvider();
    const backup = new CloudBackup(provider);
    await expect(
      backup.uploadEncryptedKey("", { version: 1 }),
    ).rejects.toBeInstanceOf(CloudValidationError);
    expect(provider.upload).not.toHaveBeenCalled();
  });

  it("throws CloudValidationError for whitespace-only string", async () => {
    const provider = makeProvider();
    const backup = new CloudBackup(provider);
    await expect(
      backup.uploadEncryptedKey("   ", { version: 1 }),
    ).rejects.toBeInstanceOf(CloudValidationError);
    expect(provider.upload).not.toHaveBeenCalled();
  });

  it("propagates CloudAuthError from provider", async () => {
    const err = new CloudAuthError("expired");
    const provider = makeProvider({
      upload: jest.fn().mockRejectedValue(err),
    });
    const backup = new CloudBackup(provider);
    await expect(
      backup.uploadEncryptedKey("valid_key", { version: 1 }),
    ).rejects.toBe(err);
  });

  it("propagates CloudStorageError from provider", async () => {
    const err = new CloudStorageError("quota");
    const provider = makeProvider({
      upload: jest.fn().mockRejectedValue(err),
    });
    const backup = new CloudBackup(provider);
    await expect(
      backup.uploadEncryptedKey("valid_key", { version: 1 }),
    ).rejects.toBe(err);
  });

  it("propagates CloudUnavailableError from provider", async () => {
    const err = new CloudUnavailableError("offline");
    const provider = makeProvider({
      upload: jest.fn().mockRejectedValue(err),
    });
    const backup = new CloudBackup(provider);
    await expect(
      backup.uploadEncryptedKey("valid_key", { version: 1 }),
    ).rejects.toBe(err);
  });

  it("accepts keys with leading/trailing spaces (not blank)", async () => {
    const provider = makeProvider();
    const backup = new CloudBackup(provider);
    await backup.uploadEncryptedKey(" a ", { version: 1 });
    expect(provider.upload).toHaveBeenCalledWith(" a ", { version: 1 });
  });
});

// ---------------------------------------------------------------------------
// downloadEncryptedKey
// ---------------------------------------------------------------------------

describe("CloudBackup.downloadEncryptedKey", () => {
  it("returns CloudEncryptionKeyFile when provider returns payload", async () => {
    const provider = makeProvider({
      download: jest.fn().mockResolvedValue(SAMPLE_PAYLOAD),
    });
    const backup = new CloudBackup(provider);
    const result = await backup.downloadEncryptedKey();
    expect(result).toEqual(SAMPLE_PAYLOAD);
  });

  it("returns null when no backup exists", async () => {
    const provider = makeProvider({
      download: jest.fn().mockResolvedValue(null),
    });
    const backup = new CloudBackup(provider);
    const result = await backup.downloadEncryptedKey();
    expect(result).toBeNull();
  });

  it("calls provider.download exactly once", async () => {
    const provider = makeProvider();
    const backup = new CloudBackup(provider);
    await backup.downloadEncryptedKey();
    expect(provider.download).toHaveBeenCalledTimes(1);
  });

  it("propagates provider error", async () => {
    const err = new CloudStorageError("corrupt");
    const provider = makeProvider({
      download: jest.fn().mockRejectedValue(err),
    });
    const backup = new CloudBackup(provider);
    await expect(backup.downloadEncryptedKey()).rejects.toBe(err);
  });
});

// ---------------------------------------------------------------------------
// deleteBackup
// ---------------------------------------------------------------------------

describe("CloudBackup.deleteBackup", () => {
  it("calls provider.delete", async () => {
    const provider = makeProvider();
    const backup = new CloudBackup(provider);
    await backup.deleteBackup();
    expect(provider.delete).toHaveBeenCalledTimes(1);
  });

  it("propagates provider error", async () => {
    const err = new CloudStorageError("cant delete");
    const provider = makeProvider({
      delete: jest.fn().mockRejectedValue(err),
    });
    const backup = new CloudBackup(provider);
    await expect(backup.deleteBackup()).rejects.toBe(err);
  });
});

// ---------------------------------------------------------------------------
// isAvailable
// ---------------------------------------------------------------------------

describe("CloudBackup.isAvailable", () => {
  it("returns true when provider says available", async () => {
    const provider = makeProvider({
      isAvailable: jest.fn().mockResolvedValue(true),
    });
    const backup = new CloudBackup(provider);
    await expect(backup.isAvailable()).resolves.toBe(true);
  });

  it("returns false when provider says unavailable", async () => {
    const provider = makeProvider({
      isAvailable: jest.fn().mockResolvedValue(false),
    });
    const backup = new CloudBackup(provider);
    await expect(backup.isAvailable()).resolves.toBe(false);
  });

  it("calls provider.isAvailable exactly once", async () => {
    const provider = makeProvider();
    const backup = new CloudBackup(provider);
    await backup.isAvailable();
    expect(provider.isAvailable).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// exists
// ---------------------------------------------------------------------------

describe("CloudBackup.exists", () => {
  it("returns true when provider says backup exists", async () => {
    const provider = makeProvider({
      exists: jest.fn().mockResolvedValue(true),
    });
    const backup = new CloudBackup(provider);
    await expect(backup.exists()).resolves.toBe(true);
  });

  it("returns false when provider says no backup", async () => {
    const provider = makeProvider({
      exists: jest.fn().mockResolvedValue(false),
    });
    const backup = new CloudBackup(provider);
    await expect(backup.exists()).resolves.toBe(false);
  });

  it("calls provider.exists exactly once", async () => {
    const provider = makeProvider();
    const backup = new CloudBackup(provider);
    await backup.exists();
    expect(provider.exists).toHaveBeenCalledTimes(1);
  });
});
