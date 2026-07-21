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
// Stored payload shape
// ---------------------------------------------------------------------------

/**
 * The JSON blob written to cloud storage by every provider.
 *
 * @typedef {Object} CloudEncryptionKeyFile
 * @property {string} encryptionKey - The encrypted wallet master key.
 * @property {string} savedAt - ISO-8601 UTC timestamp when the backup was saved.
 * @property {string} cloudEmail - Cloud user email that owns this backup.
 */

// ---------------------------------------------------------------------------
// Provider contract
// ---------------------------------------------------------------------------

/**
 * Abstraction over any cloud storage backend.
 * Implementations should expose cloud operations without persisting backup
 * data locally inside this SDK.
 *
 * - `upload` stores `encryptedKey`; if a backup already exists it MUST be
 *   overwritten.
 * - `download` retrieves the stored backup, or `null` if none exists yet.
 * - `delete` permanently removes the backup and MUST be idempotent.
 * - `isAvailable` is a lightweight probe — not a full upload/download.
 * - `exists` reports whether a backup file exists without downloading it.
 *
 * @typedef {Object} CloudProvider
 * @property {(encryptedKey: string) => Promise<CloudEncryptionKeyFile>} upload
 * @property {() => Promise<CloudEncryptionKeyFile | null>} download
 * @property {() => Promise<void>} delete
 * @property {() => Promise<boolean>} isAvailable
 * @property {() => Promise<boolean>} exists
 */

// ---------------------------------------------------------------------------
// Provider configurations
// ---------------------------------------------------------------------------

/**
 * Config for {@link GoogleDriveProvider}.
 * The caller is responsible for acquiring and refreshing the token.
 * This SDK performs NO OAuth flows.
 *
 * Provide either `accessToken` (static) or `getAccessToken` (fresh per request).
 * If both are set, `getAccessToken` wins.
 *
 * @typedef {Object} GoogleDriveConfig
 * @property {string} [accessToken] - A valid OAuth2 access token scoped to `drive.appdata`.
 * @property {() => Promise<string>} [getAccessToken] - Returns a fresh OAuth2 access token before each Drive API call.
 * @property {string} [filePath] - Override the backup file path. Default: `wallet_backup_key.json`.
 * @property {string} [cloudEmail] - The user's cloud email — stored inside the backup file for traceability.
 * @property {number} [timeout] - Network timeout in milliseconds for Google Drive API calls. Default: 30000.
 */

/**
 * CloudKit Web Services credentials supplied by the caller.
 * The app obtains these via CloudKit JS / native CloudKit sign-in.
 *
 * @typedef {Object} CloudKitAuthContext
 * @property {string} apiToken - API token from the CloudKit Dashboard (web services).
 * @property {string} webAuthToken - User web auth token for private database access.
 */

/**
 * Config for {@link CloudKitProvider}.
 *
 * @typedef {Object} CloudKitConfig
 * @property {string} containerIdentifier - CloudKit container identifier, e.g. `iCloud.com.example.app`.
 * @property {'development' | 'production'} environment - CloudKit environment.
 * @property {string} [zoneName] - Custom zone name. Default: `_defaultZone`.
 * @property {string} [recordName] - Stable record name for the backup. Default: `wallet_backup_key`.
 * @property {string} [recordType] - CloudKit record type. Default: `WalletBackup`.
 * @property {string} [cloudEmail] - The user's cloud email — stored inside the backup record for traceability.
 * @property {() => Promise<CloudKitAuthContext>} getCloudKitAuth - Returns fresh CloudKit web auth credentials before each API call.
 * @property {number} [maxSyncRetries] - Max number of record fetch retries during download. Default: `10`.
 * @property {number} [syncRetryDelayMs] - Delay in ms between fetch retries during download. Default: `1000`.
 * @property {number} [timeout] - Network timeout in milliseconds. Default: `30000`.
 */

export {}
