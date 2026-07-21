/**
 * The JSON blob written to cloud storage by every provider.
 */
export type CloudEncryptionKeyFile = {
    /**
     * - The encrypted wallet master key.
     */
    encryptionKey: string;
    /**
     * - ISO-8601 UTC timestamp when the backup was saved.
     */
    savedAt: string;
    /**
     * - Cloud user email that owns this backup.
     */
    cloudEmail: string;
};
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
 */
export type CloudProvider = {
    upload: (encryptedKey: string) => Promise<CloudEncryptionKeyFile>;
    download: () => Promise<CloudEncryptionKeyFile | null>;
    delete: () => Promise<void>;
    isAvailable: () => Promise<boolean>;
    exists: () => Promise<boolean>;
};
/**
 * Config for {@link GoogleDriveProvider}.
 * The caller is responsible for acquiring and refreshing the token.
 * This SDK performs NO OAuth flows.
 *
 * Provide either `accessToken` (static) or `getAccessToken` (fresh per request).
 * If both are set, `getAccessToken` wins.
 */
export type GoogleDriveConfig = {
    /**
     * - A valid OAuth2 access token scoped to `drive.appdata`.
     */
    accessToken?: string;
    /**
     * - Returns a fresh OAuth2 access token before each Drive API call.
     */
    getAccessToken?: () => Promise<string>;
    /**
     * - Override the backup file path. Default: `wallet_backup_key.json`.
     */
    filePath?: string;
    /**
     * - The user's cloud email — stored inside the backup file for traceability.
     */
    cloudEmail?: string;
    /**
     * - Network timeout in milliseconds for Google Drive API calls. Default: 30000.
     */
    timeout?: number;
};
/**
 * CloudKit Web Services credentials supplied by the caller.
 * The app obtains these via CloudKit JS / native CloudKit sign-in.
 */
export type CloudKitAuthContext = {
    /**
     * - API token from the CloudKit Dashboard (web services).
     */
    apiToken: string;
    /**
     * - User web auth token for private database access.
     */
    webAuthToken: string;
};
/**
 * Config for {@link CloudKitProvider}.
 */
export type CloudKitConfig = {
    /**
     * - CloudKit container identifier, e.g. `iCloud.com.example.app`.
     */
    containerIdentifier: string;
    /**
     * - CloudKit environment.
     */
    environment: "development" | "production";
    /**
     * - Custom zone name. Default: `_defaultZone`.
     */
    zoneName?: string;
    /**
     * - Stable record name for the backup. Default: `wallet_backup_key`.
     */
    recordName?: string;
    /**
     * - CloudKit record type. Default: `WalletBackup`.
     */
    recordType?: string;
    /**
     * - The user's cloud email — stored inside the backup record for traceability.
     */
    cloudEmail?: string;
    /**
     * - Returns fresh CloudKit web auth credentials before each API call.
     */
    getCloudKitAuth: () => Promise<CloudKitAuthContext>;
    /**
     * - Max number of record fetch retries during download. Default: `10`.
     */
    maxSyncRetries?: number;
    /**
     * - Delay in ms between fetch retries during download. Default: `1000`.
     */
    syncRetryDelayMs?: number;
    /**
     * - Network timeout in milliseconds. Default: `30000`.
     */
    timeout?: number;
};
