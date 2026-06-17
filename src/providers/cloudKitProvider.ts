// Copyright 2026 Tether Operations Limited
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * CloudKitProvider — stores the encrypted master key in the user's CloudKit
 * private database via CloudKit Web Services.
 *
 * Design constraints:
 *  - Uses CloudKit private database records (not legacy iCloud Drive files).
 *  - Caller supplies CloudKit web auth via `getCloudKitAuth`.
 *  - Payload mirrors `CloudEncryptionKeyFile`.
 *  - Never logs the encrypted key material or auth tokens.
 */

import {
  CloudAuthError,
  CloudStorageError,
  CloudUnavailableError,
} from "../errors.js";
import type {
  CloudEncryptionKeyFile,
  CloudKitAuthContext,
  CloudProvider,
  CloudKitConfig,
} from "../types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLOUDKIT_API_BASE = "https://api.apple-cloudkit.com/database/1";
const DEFAULT_ZONE_NAME = "_defaultZone";
const DEFAULT_RECORD_NAME = "wallet_backup_key";
const DEFAULT_RECORD_TYPE = "WalletBackup";
const DEFAULT_MAX_SYNC_RETRIES = 10;
const DEFAULT_SYNC_RETRY_DELAY_MS = 1000;
const DEFAULT_TIMEOUT_MS = 30_000;

const BACKUP_FIELD_KEYS = [
  "encryptionKey",
  "savedAt",
  "platform",
  "version",
  "cloudEmail",
] as const;

// ---------------------------------------------------------------------------
// CloudKit response shapes (subset)
// ---------------------------------------------------------------------------

interface CloudKitFieldValue {
  value?: string | number;
}

interface CloudKitRecord {
  recordName?: string;
  recordType?: string;
  reason?: string;
  fields?: Record<string, CloudKitFieldValue>;
}

interface CloudKitLookupResponse {
  records?: CloudKitRecord[];
}

interface CloudKitModifyResponse {
  records?: CloudKitRecord[];
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class CloudKitProvider implements CloudProvider {
  private readonly containerIdentifier: string;
  private readonly environment: "development" | "production";
  private readonly zoneName: string;
  private readonly recordName: string;
  private readonly recordType: string;
  private readonly cloudEmail: string;
  private readonly getCloudKitAuth: () => Promise<CloudKitAuthContext>;
  private readonly fetchFn = globalThis.fetch.bind(globalThis);
  private readonly maxSyncRetries: number;
  private readonly syncRetryDelayMs: number;
  private readonly timeoutMs: number;

  constructor(config: CloudKitConfig) {
    this.containerIdentifier = config.containerIdentifier;
    this.environment = config.environment;
    this.zoneName = config.zoneName ?? DEFAULT_ZONE_NAME;
    this.recordName = config.recordName ?? DEFAULT_RECORD_NAME;
    this.recordType = config.recordType ?? DEFAULT_RECORD_TYPE;
    this.cloudEmail = config.cloudEmail ?? "";
    this.getCloudKitAuth = config.getCloudKitAuth;
    this.maxSyncRetries = config.maxSyncRetries ?? DEFAULT_MAX_SYNC_RETRIES;
    this.syncRetryDelayMs =
      config.syncRetryDelayMs ?? DEFAULT_SYNC_RETRY_DELAY_MS;
    this.timeoutMs = config.timeout ?? DEFAULT_TIMEOUT_MS;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async upload(
    encryptedKey: string,
    metadata: Record<string, unknown>,
  ): Promise<CloudEncryptionKeyFile | null> {
    await this.assertAvailable();

    const payload: CloudEncryptionKeyFile = {
      encryptionKey: encryptedKey,
      savedAt: metadata.savedAt
        ? metadata.savedAt.toString()
        : new Date().toISOString(),
      platform: "ios",
      version: metadata.version ? (metadata.version as number) : 1,
      cloudEmail: this.cloudEmail,
    };

    try {
      await this.saveRecord(payload);
    } catch (cause) {
      throw this.mapError(cause, "Failed to write backup to CloudKit");
    }

    try {
      const verified = await this.recordExists();
      if (!verified) {
        throw new CloudStorageError(
          "CloudKit backup failed: record not found after write",
        );
      }
      return payload;
    } catch (cause) {
      if (cause instanceof CloudStorageError) throw cause;
      throw this.mapError(cause, "Failed to verify CloudKit backup");
    }
  }

  async download(): Promise<CloudEncryptionKeyFile | null> {
    await this.assertAvailable();

    const exists = await this.recordExists();
    if (!exists) return null;

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxSyncRetries; attempt++) {
      try {
        const record = await this.lookupRecord();
        if (!record) return null;
        return this.recordToPayload(record);
      } catch (cause) {
        lastError = cause;
        if (cause instanceof CloudStorageError) throw cause;
        if (this.isAuthError(cause)) {
          throw this.mapError(cause, "Failed to read backup from CloudKit");
        }
        if (attempt < this.maxSyncRetries) {
          await new Promise((r) => setTimeout(r, this.syncRetryDelayMs));
        }
      }
    }

    throw this.mapError(
      lastError,
      `Failed to read backup from CloudKit after ${this.maxSyncRetries} attempts`,
    );
  }

  async delete(): Promise<void> {
    await this.assertAvailable();

    const exists = await this.recordExists();
    if (!exists) return;

    try {
      await this.deleteRecord();
    } catch (cause) {
      throw this.mapError(cause, "Failed to delete backup from CloudKit");
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.probeCloudKit();
      return true;
    } catch {
      return false;
    }
  }

  async exists(): Promise<boolean> {
    try {
      const available = await this.isAvailable();
      if (!available) return false;
      return await this.recordExists();
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // CloudKit API helpers
  // -------------------------------------------------------------------------

  private databaseUrl(path: string, apiToken: string): string {
    const base = `${CLOUDKIT_API_BASE}/${encodeURIComponent(this.containerIdentifier)}/${this.environment}/private/${path}`;
    return `${base}?ckAPIToken=${encodeURIComponent(apiToken)}`;
  }

  private zoneId(): { zoneName: string } {
    return { zoneName: this.zoneName };
  }

  private async cloudKitRequest(
    path: string,
    auth: CloudKitAuthContext,
    body: unknown,
    method = "POST",
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await this.fetchFn(this.databaseUrl(path, auth.apiToken), {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Apple-CloudKit-Web-Auth-Token": auth.webAuthToken,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") {
        throw new Error("network timeout");
      }
      throw cause;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async probeCloudKit(): Promise<void> {
    const auth = await this.getCloudKitAuth();
    const response = await this.cloudKitRequest("records/lookup", auth, {
      records: [
        {
          recordName: this.recordName,
          desiredKeys: [...BACKUP_FIELD_KEYS],
        },
      ],
      zoneID: this.zoneId(),
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error("401 unauthorized");
    }

    if (!response.ok) {
      throw await this.httpError(response, "CloudKit availability check failed");
    }
  }

  private async lookupRecord(): Promise<CloudKitRecord | null> {
    const auth = await this.getCloudKitAuth();
    const response = await this.cloudKitRequest("records/lookup", auth, {
      records: [
        {
          recordName: this.recordName,
          desiredKeys: [...BACKUP_FIELD_KEYS],
        },
      ],
      zoneID: this.zoneId(),
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error("401 unauthorized");
    }

    if (!response.ok) {
      throw await this.httpError(response, "CloudKit record lookup failed");
    }

    const body = (await response.json()) as CloudKitLookupResponse;
    const record = body.records?.[0];
    if (!record || record.reason === "RECORD_NOT_FOUND") {
      return null;
    }
    if (record.reason) {
      throw new Error(record.reason);
    }
    return record;
  }

  private async recordExists(): Promise<boolean> {
    const record = await this.lookupRecord();
    return record !== null;
  }

  private async saveRecord(payload: CloudEncryptionKeyFile): Promise<void> {
    const auth = await this.getCloudKitAuth();
    const response = await this.cloudKitRequest("records/modify", auth, {
      operations: [
        {
          operationType: "forceUpdate",
          record: {
            recordType: this.recordType,
            recordName: this.recordName,
            fields: {
              encryptionKey: { value: payload.encryptionKey },
              savedAt: { value: payload.savedAt },
              platform: { value: payload.platform },
              version: { value: payload.version },
              cloudEmail: { value: payload.cloudEmail },
            },
          },
        },
      ],
      zoneID: this.zoneId(),
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error("401 unauthorized");
    }

    if (!response.ok) {
      throw await this.httpError(response, "CloudKit record save failed");
    }

    const body = (await response.json()) as CloudKitModifyResponse;
    const result = body.records?.[0];
    if (result?.reason && result.reason !== "RECORD_CHANGED") {
      throw new Error(result.reason);
    }
  }

  private async deleteRecord(): Promise<void> {
    const auth = await this.getCloudKitAuth();
    const response = await this.cloudKitRequest("records/modify", auth, {
      operations: [
        {
          operationType: "delete",
          record: {
            recordType: this.recordType,
            recordName: this.recordName,
          },
        },
      ],
      zoneID: this.zoneId(),
    });

    if (response.status === 404) return;

    if (response.status === 401 || response.status === 403) {
      throw new Error("401 unauthorized");
    }

    if (!response.ok) {
      throw await this.httpError(response, "CloudKit record delete failed");
    }
  }

  private recordToPayload(record: CloudKitRecord): CloudEncryptionKeyFile {
    const fields = record.fields ?? {};
    const encryptionKey = fields.encryptionKey?.value;
    if (typeof encryptionKey !== "string") {
      throw new CloudStorageError(
        "CloudKit backup payload has an unexpected shape",
      );
    }

    const versionRaw = fields.version?.value;
    const version =
      typeof versionRaw === "number"
        ? versionRaw
        : typeof versionRaw === "string"
          ? Number(versionRaw)
          : 1;

    return {
      encryptionKey,
      savedAt:
        typeof fields.savedAt?.value === "string"
          ? fields.savedAt.value
          : new Date().toISOString(),
      platform:
        fields.platform?.value === "android" ? "android" : "ios",
      version: Number.isFinite(version) ? version : 1,
      cloudEmail:
        typeof fields.cloudEmail?.value === "string"
          ? fields.cloudEmail.value
          : "",
    };
  }

  private async httpError(
    response: Response,
    context: string,
  ): Promise<Error> {
    let detail = "";
    try {
      const text = await response.text();
      detail = text.slice(0, 200);
    } catch {
      detail = response.statusText;
    }
    return new Error(`${response.status} ${context}: ${detail}`);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async assertAvailable(): Promise<void> {
    try {
      await this.probeCloudKit();
    } catch (cause) {
      if (this.isAuthError(cause)) {
        throw new CloudAuthError(
          "CloudKit user not signed in — authentication failed",
          cause,
        );
      }
      throw new CloudUnavailableError(
        "CloudKit is not available. Ensure the user is signed in and CloudKit is enabled.",
        cause,
      );
    }
  }

  private isAuthError(cause: unknown): boolean {
    const msg =
      cause instanceof Error ? cause.message.toLowerCase() : String(cause);
    return (
      msg.includes("401") ||
      msg.includes("403") ||
      msg.includes("not signed in") ||
      msg.includes("no account") ||
      msg.includes("unauthorized") ||
      msg.includes("unauthenticated")
    );
  }

  private mapError(cause: unknown, context: string): Error {
    const msg =
      cause instanceof Error ? cause.message.toLowerCase() : String(cause);

    if (this.isAuthError(cause)) {
      return new CloudAuthError(
        `CloudKit user not signed in — ${context}`,
        cause,
      );
    }

    if (
      msg.includes("quota") ||
      msg.includes("insufficient storage") ||
      msg.includes("storage full")
    ) {
      return new CloudStorageError(
        `CloudKit storage quota exceeded — ${context}`,
        cause,
      );
    }

    if (
      msg.includes("unavailable") ||
      msg.includes("disabled") ||
      msg.includes("not available") ||
      msg.includes("network") ||
      msg.includes("timeout") ||
      msg.includes("abort")
    ) {
      return new CloudUnavailableError(
        `CloudKit service unavailable — ${context}`,
        cause,
      );
    }

    return new CloudStorageError(`${context}: ${msg}`, cause);
  }
}
