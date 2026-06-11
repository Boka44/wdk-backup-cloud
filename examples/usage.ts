/**
 * @tetherto/wdk-backup-cloud
 * Integration usage example.
 */

import {
  CloudBackup,
  CloudAuthError,
  CloudKitProvider,
  CloudStorageError,
  CloudUnavailableError,
  CloudValidationError,
  GoogleDriveProvider,
} from "@tetherto/wdk-backup-cloud";
import type { CloudKitAuthContext } from "@tetherto/wdk-backup-cloud";

// =============================================================================
// Example 1 — Google Drive
// =============================================================================

async function backupWithGoogleDrive(
  accessToken: string,
  encryptedKey: string,
): Promise<void> {
  const provider = new GoogleDriveProvider({ accessToken });
  const cloud = new CloudBackup(provider);

  const available = await cloud.isAvailable();
  if (!available) {
    console.warn("Google Drive is not accessible right now. Skipping backup.");
    return;
  }

  try {
    await cloud.uploadEncryptedKey(encryptedKey, { version: 1 });
    console.info("Backup uploaded to Google Drive successfully.");

    const downloaded = await cloud.downloadEncryptedKey();
    if (downloaded === null) {
      console.warn("No backup found in Google Drive.");
    } else {
      console.info("Backup downloaded — key retrieved (value not logged).");
    }

    await cloud.deleteBackup();
    console.info("Backup deleted from Google Drive.");
  } catch (err) {
    if (err instanceof CloudValidationError) {
      console.error("Invalid key supplied:", err.message);
    } else if (err instanceof CloudAuthError) {
      console.error(
        "Authentication failed — refresh token and retry:",
        err.message,
      );
    } else if (err instanceof CloudUnavailableError) {
      console.error("Google Drive unavailable:", err.message);
    } else if (err instanceof CloudStorageError) {
      console.error("Storage error:", err.message);
    } else {
      throw err;
    }
  }
}

// =============================================================================
// Example 2 — CloudKit
// =============================================================================

async function backupWithCloudKit(encryptedKey: string): Promise<void> {
  const provider = new CloudKitProvider({
    containerIdentifier: "iCloud.com.example.wallet",
    environment: "production",
    getCloudKitAuth: async (): Promise<CloudKitAuthContext> => ({
      apiToken: process.env.CLOUDKIT_API_TOKEN ?? "",
      webAuthToken: process.env.CLOUDKIT_WEB_AUTH_TOKEN ?? "",
    }),
  });
  const cloud = new CloudBackup(provider);

  const available = await cloud.isAvailable();
  if (!available) {
    console.warn(
      "CloudKit is not available. Ensure the user is signed in and CloudKit is enabled.",
    );
    return;
  }

  try {
    await cloud.uploadEncryptedKey(encryptedKey, { version: 1 });
    console.info("Backup uploaded to CloudKit.");

    const downloaded = await cloud.downloadEncryptedKey();
    if (downloaded !== null) {
      console.info("Backup verified in CloudKit.");
    }
  } catch (err) {
    if (err instanceof CloudAuthError) {
      console.error("CloudKit: user not signed in:", err.message);
    } else if (err instanceof CloudUnavailableError) {
      console.error("CloudKit unavailable:", err.message);
    } else if (err instanceof CloudStorageError) {
      console.error("CloudKit storage error (quota?):", err.message);
    } else {
      throw err;
    }
  }
}

// =============================================================================
// Example 3 — Full flow: backend + cloud backup
// =============================================================================

async function fullBackupFlow(
  accessToken: string,
  encryptedKey: string,
): Promise<void> {
  const cloudProvider = new GoogleDriveProvider({ accessToken });
  const cloud = new CloudBackup(cloudProvider);

  await cloud.uploadEncryptedKey(encryptedKey, { version: 1 });

  console.info("Full backup complete — backend + cloud.");
}

export { backupWithGoogleDrive, backupWithCloudKit, fullBackupFlow };
