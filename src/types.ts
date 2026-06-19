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
 * Core type definitions — no runtime code.
 */

// ---------------------------------------------------------------------------
// Provider contract
// ---------------------------------------------------------------------------

/**
 * Abstraction over any cloud storage backend.
 * Implementations should expose cloud operations without persisting backup
 * data locally inside this SDK.
 */
export interface CloudProvider {
  /**
   * Store `encryptedKey` in the provider's cloud storage.
   * If a backup already exists, it MUST be overwritten.
   */
  upload(encryptedKey: string): Promise<CloudEncryptionKeyFile | null>;

  /**
   * Retrieve the stored encrypted key backup file.
   * Returns `null` if no backup exists yet.
   */
  download(): Promise<CloudEncryptionKeyFile | null>;

  /**
   * Permanently remove the stored backup.
   * Must be idempotent — calling on a missing file must NOT throw.
   */
  delete(): Promise<void>;

  /**
   * Returns `true` if the provider is accessible right now.
   * Should be a lightweight probe — not a full upload/download.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Returns `true` if a backup file exists in cloud storage.
   * Does not download the content.
   */
  exists(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Provider configurations
// ---------------------------------------------------------------------------

/**
 * Config for {@link GoogleDriveProvider}.
 * The caller is responsible for acquiring and refreshing the token.
 * This SDK performs NO OAuth flows.
 */
export interface GoogleDriveConfig {
  /** A valid OAuth2 access token scoped to `drive.appdata`. */
  readonly accessToken: string;
  /** Override the backup file path. Default: `wallet_backup_key.json` */
  readonly filePath?: string;
  /** The user's cloud email — stored inside the backup file for traceability. */
  readonly cloudEmail?: string;
  /** Network timeout in milliseconds for Google Drive API calls. Default: 30000 */
  readonly timeout?: number;
}

/**
 * CloudKit Web Services credentials supplied by the caller.
 * The app obtains these via CloudKit JS / native CloudKit sign-in.
 */
export interface CloudKitAuthContext {
  /** API token from the CloudKit Dashboard (web services). */
  readonly apiToken: string;
  /** User web auth token for private database access. */
  readonly webAuthToken: string;
}

/**
 * Config for {@link CloudKitProvider}.
 */
export interface CloudKitConfig {
  /** CloudKit container identifier, e.g. `iCloud.com.example.app`. */
  readonly containerIdentifier: string;
  /** CloudKit environment. */
  readonly environment: "development" | "production";
  /** Custom zone name. Default: `_defaultZone` */
  readonly zoneName?: string;
  /** Stable record name for the backup. Default: `wallet_backup_key` */
  readonly recordName?: string;
  /** CloudKit record type. Default: `WalletBackup` */
  readonly recordType?: string;
  /** The user's cloud email — stored inside the backup record for traceability. */
  readonly cloudEmail?: string;
  /** Returns fresh CloudKit web auth credentials before each API call. */
  readonly getCloudKitAuth: () => Promise<CloudKitAuthContext>;
  /** Max number of record fetch retries during download. Default: `10` */
  readonly maxSyncRetries?: number;
  /** Delay in ms between fetch retries during download. Default: `1000` */
  readonly syncRetryDelayMs?: number;
  /** Network timeout in milliseconds. Default: `30000` */
  readonly timeout?: number;
}

// ---------------------------------------------------------------------------
// Stored payload shape
// ---------------------------------------------------------------------------

/**
 * The JSON blob written to cloud storage by every provider.
 */
export interface CloudEncryptionKeyFile {
  /** The encrypted wallet master key */
  readonly encryptionKey: string;
  /** ISO-8601 UTC timestamp when the backup was saved */
  readonly savedAt: string;
  /** Cloud user email that owns this backup */
  readonly cloudEmail: string;
}
