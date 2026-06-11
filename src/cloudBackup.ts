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
 * CloudBackup — public facade that wraps any CloudProvider.
 *
 * Responsibilities:
 *  - Validate inputs (non-empty key)
 *  - Delegate to the injected provider
 *  - Never log sensitive data
 *  - Normalise provider errors (re-throw as-is, since providers already use
 *    our typed error classes)
 */

import { CloudValidationError } from "./errors.js";
import type { CloudEncryptionKeyFile, CloudProvider } from "./types.js";

export class CloudBackup {
  private readonly provider: CloudProvider;

  constructor(provider: CloudProvider) {
    this.provider = provider;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Upload the encrypted master key to cloud storage.
   *
   * @param key - The encrypted wallet master key (must be non-empty).
   * @throws {CloudValidationError} if `key` is empty or whitespace-only.
   * @throws {CloudUnavailableError} if the cloud service is unreachable.
   * @throws {CloudAuthError} if credentials are invalid.
   * @throws {CloudStorageError} if the write fails.
   */
  async uploadEncryptedKey(
    key: string,
    metadata: Record<string, unknown>,
  ): Promise<CloudEncryptionKeyFile | null> {
    this.validateKey(key);
    return await this.provider.upload(key, metadata);
  }

  /**
   * Download the encrypted master key from cloud storage.
   *
   * @returns The encrypted key file, or `null` if no backup exists yet.
   * @throws {CloudUnavailableError} if the cloud service is unreachable.
   * @throws {CloudAuthError} if credentials are invalid.
   * @throws {CloudStorageError} if the read fails.
   */
  async downloadEncryptedKey(): Promise<CloudEncryptionKeyFile | null> {
    return this.provider.download();
  }

  /**
   * Permanently delete the cloud backup.
   * Idempotent — safe to call even when no backup exists.
   *
   * @throws {CloudUnavailableError} if the cloud service is unreachable.
   * @throws {CloudAuthError} if credentials are invalid.
   * @throws {CloudStorageError} if the delete fails.
   */
  async deleteBackup(): Promise<void> {
    return this.provider.delete();
  }

  /**
   * Check whether the cloud provider is accessible right now.
   *
   * @returns `true` if available, `false` otherwise (never throws).
   */
  async isAvailable(): Promise<boolean> {
    return this.provider.isAvailable();
  }

  /**
   * Check whether a backup file exists in cloud storage.
   * Does not download the content — lightweight existence check.
   *
   * @returns `true` if the backup file exists, `false` otherwise (never throws).
   */
  async exists(): Promise<boolean> {
    return this.provider.exists();
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private validateKey(key: string): void {
    if (key.trim().length === 0) {
      throw new CloudValidationError(
        "Encrypted key must be a non-empty string",
      );
    }
  }
}
