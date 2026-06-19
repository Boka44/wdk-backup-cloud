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
 * GoogleDriveProvider — stores the encrypted master key in the caller's
 * Google Drive `appDataFolder` via Drive API v3.
 *
 * Design constraints:
 *  - No Google sign-in logic. The caller injects a valid OAuth2 access token.
 *  - Uses `appDataFolder` scope for app-specific hidden storage.
 *  - Never logs the access token or encrypted key material.
 */

import {
  CloudAuthError,
  CloudStorageError,
  CloudUnavailableError,
} from "../errors.js";
import type {
  CloudEncryptionKeyFile,
  CloudProvider,
  GoogleDriveConfig,
} from "../types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_FILE_PATH = "wallet_backup_key.json";
const DEFAULT_TIMEOUT_MS = 30_000;
const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";
const APP_DATA_FOLDER = "appDataFolder";

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class GoogleDriveProvider implements CloudProvider {
  private readonly accessToken: string;
  private readonly filePath: string;
  private readonly cloudEmail: string;
  private readonly timeoutMs: number;
  private readonly fetchFn = globalThis.fetch.bind(globalThis);

  constructor(config: GoogleDriveConfig) {
    this.accessToken = config.accessToken;
    this.filePath = config.filePath ?? DEFAULT_FILE_PATH;
    this.cloudEmail = config.cloudEmail ?? "";
    this.timeoutMs = config.timeout ?? DEFAULT_TIMEOUT_MS;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async upload(encryptedKey: string): Promise<CloudEncryptionKeyFile | null> {
    const payload: CloudEncryptionKeyFile = {
      encryptionKey: encryptedKey,
      savedAt: new Date().toISOString(),
      cloudEmail: this.cloudEmail,
    };

    const content = JSON.stringify(payload);

    try {
      const existingId = await this.findFileId();
      if (existingId) {
        await this.updateFile(existingId, content);
      } else {
        await this.createFile(content);
      }
    } catch (cause) {
      throw this.mapError(cause, "Failed to write backup to Google Drive");
    }

    try {
      const verified = await this.fileExists();
      if (!verified) {
        throw new CloudStorageError(
          "Google Drive backup failed: file not found after write",
        );
      }
      return payload;
    } catch (cause) {
      if (cause instanceof CloudStorageError) throw cause;
      throw this.mapError(cause, "Failed to verify Google Drive backup");
    }
  }

  async download(): Promise<CloudEncryptionKeyFile | null> {
    let fileId: string | null;
    try {
      fileId = await this.findFileId();
    } catch (cause) {
      if (this.isNotFoundError(cause)) return null;
      throw this.mapError(cause, "Failed to check Google Drive file existence");
    }

    if (!fileId) return null;

    let raw: string;
    try {
      raw = await this.readFileContent(fileId);
    } catch (cause) {
      if (this.isNotFoundError(cause)) return null;
      throw this.mapError(cause, "Failed to read backup from Google Drive");
    }

    return this.parsePayload(raw);
  }

  async delete(): Promise<void> {
    let fileId: string | null;
    try {
      fileId = await this.findFileId();
    } catch (cause) {
      if (this.isNotFoundError(cause)) return;
      throw this.mapError(cause, "Failed to check Google Drive file existence");
    }

    if (!fileId) return;

    try {
      await this.deleteFile(fileId);
    } catch (cause) {
      throw this.mapError(cause, "Failed to delete backup from Google Drive");
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await this.driveRequest(
        `${DRIVE_API_BASE}/about?fields=user`,
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  async exists(): Promise<boolean> {
    try {
      return await this.fileExists();
    } catch (cause) {
      if (this.isNotFoundError(cause)) return false;
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Drive API helpers
  // -------------------------------------------------------------------------

  private escapeDriveQueryValue(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }

  private async findFileId(): Promise<string | null> {
    const fileName = this.filePath.split("/").pop() ?? this.filePath;
    const q = `name='${this.escapeDriveQueryValue(fileName)}' and '${APP_DATA_FOLDER}' in parents and trashed=false`;
    const url = `${DRIVE_API_BASE}/files?spaces=${APP_DATA_FOLDER}&q=${encodeURIComponent(q)}&fields=files(id,name)`;
    const response = await this.driveRequest(url);

    if (response.status === 404) return null;

    if (!response.ok) {
      throw await this.httpError(response, "Failed to list Google Drive files");
    }

    const body = (await response.json()) as { files?: Array<{ id: string }> };
    return body.files?.[0]?.id ?? null;
  }

  private async fileExists(): Promise<boolean> {
    const id = await this.findFileId();
    return id !== null;
  }

  private async createFile(content: string): Promise<void> {
    const fileName = this.filePath.split("/").pop() ?? this.filePath;
    const boundary = `wdk_backup_${Date.now()}`;
    const metadata = JSON.stringify({
      name: fileName,
      parents: [APP_DATA_FOLDER],
    });
    const body = [
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      metadata,
      `--${boundary}`,
      "Content-Type: application/json",
      "",
      content,
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const response = await this.driveRequest(
      `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart`,
      {
        method: "POST",
        headers: {
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    );

    if (!response.ok) {
      throw await this.httpError(response, "Failed to create Google Drive file");
    }
  }

  private async updateFile(fileId: string, content: string): Promise<void> {
    const response = await this.driveRequest(
      `${DRIVE_UPLOAD_BASE}/files/${fileId}?uploadType=media`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: content,
      },
    );

    if (!response.ok) {
      throw await this.httpError(response, "Failed to update Google Drive file");
    }
  }

  private async readFileContent(fileId: string): Promise<string> {
    const response = await this.driveRequest(
      `${DRIVE_API_BASE}/files/${fileId}?alt=media`,
    );

    if (response.status === 404) {
      throw new Error("404 not found");
    }

    if (!response.ok) {
      throw await this.httpError(response, "Failed to download Google Drive file");
    }

    return response.text();
  }

  private async deleteFile(fileId: string): Promise<void> {
    const response = await this.driveRequest(
      `${DRIVE_API_BASE}/files/${fileId}`,
      { method: "DELETE" },
    );

    if (response.status === 404) return;

    if (!response.ok) {
      throw await this.httpError(response, "Failed to delete Google Drive file");
    }
  }

  private async driveRequest(
    url: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${this.accessToken}`);
      return await this.fetchFn(url, {
        ...init,
        headers,
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

  private isNotFoundError(cause: unknown): boolean {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return msg.includes("404") || msg.includes("not found");
  }

  private mapError(cause: unknown, context: string): Error {
    const msg =
      cause instanceof Error ? cause.message.toLowerCase() : String(cause);

    if (
      msg.includes("unauthorized") ||
      msg.includes("401") ||
      msg.includes("403") ||
      msg.includes("auth") ||
      msg.includes("unauthenticated")
    ) {
      return new CloudAuthError(
        `Google Drive authentication failed — ${context}`,
        cause,
      );
    }

    if (
      msg.includes("unavailable") ||
      msg.includes("network") ||
      msg.includes("not available") ||
      msg.includes("timeout") ||
      msg.includes("abort")
    ) {
      return new CloudUnavailableError(
        `Google Drive unavailable — ${context}`,
        cause,
      );
    }

    if (msg.includes("400") || msg.includes("malformed")) {
      return new CloudStorageError(
        `Google Drive rejected the request (400 Bad Request) — ${context}`,
        cause,
      );
    }

    return new CloudStorageError(`${context}: ${msg}`, cause);
  }

  private parsePayload(raw: string): CloudEncryptionKeyFile {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (cause) {
      throw new CloudStorageError(
        "Google Drive backup file contains invalid JSON",
        cause,
      );
    }

    if (
      parsed === null ||
      typeof parsed !== "object" ||
      typeof (parsed as Record<string, unknown>)["encryptionKey"] !== "string"
    ) {
      throw new CloudStorageError(
        "Google Drive backup payload has an unexpected shape",
      );
    }

    return parsed as CloudEncryptionKeyFile;
  }
}
