# @tetherto/wdk-backup-cloud

Cloud backup SDK for wallet apps. Stores an encrypted master key in **Google Drive** (`appDataFolder`) or **CloudKit** (private database) via a clean provider abstraction.

No React Native dependencies — providers use `fetch` against Google Drive API v3 and CloudKit Web Services.

---

## Installation

```bash
npm install @tetherto/wdk-backup-cloud
```

---

## Requirements

| Platform | Cloud Target | Requirement |
| -------- | ------------ | ----------- |
| Any      | Google Drive | OAuth2 access token with `drive.appdata` scope |
| iOS      | CloudKit     | CloudKit container + web auth token from your app |

**This SDK performs NO OAuth flows.** The caller supplies credentials.

---

## Quick Start

### Google Drive

```ts
import {
  CloudBackup,
  GoogleDriveProvider,
} from "@tetherto/wdk-backup-cloud";

const provider = new GoogleDriveProvider({ accessToken: "<your_token>" });
const cloud = new CloudBackup(provider);

await cloud.uploadEncryptedKey(encryptedKey, { version: 1 });
const backup = await cloud.downloadEncryptedKey(); // CloudEncryptionKeyFile | null
```

### CloudKit

```ts
import {
  CloudBackup,
  CloudKitProvider,
} from "@tetherto/wdk-backup-cloud";
import type { CloudKitAuthContext } from "@tetherto/wdk-backup-cloud";

const provider = new CloudKitProvider({
  containerIdentifier: "iCloud.com.example.wallet",
  environment: "production",
  getCloudKitAuth: async (): Promise<CloudKitAuthContext> => ({
    apiToken: "<cloudkit_api_token>",
    webAuthToken: "<user_web_auth_token>",
  }),
});

const cloud = new CloudBackup(provider);
await cloud.uploadEncryptedKey(encryptedKey, { version: 1 });
```

---

## CloudKit setup (integrators)

1. Enable **CloudKit** on your app in Apple Developer.
2. Create a record type `WalletBackup` (or customize via `recordType` config) with fields:
   - `encryptionKey` (String)
   - `savedAt` (String)
   - `platform` (String)
   - `version` (Int64)
   - `cloudEmail` (String)
3. Deploy schema to production.
4. Enable **CloudKit web services** and obtain an API token.
5. Wire `getCloudKitAuth()` to return fresh `apiToken` + `webAuthToken` from your app's CloudKit sign-in flow.

**Migration** from the legacy `@tetherto/wdk-backup-cloud-react-native` iCloud Drive file format is **not handled by this package** — coordinate with your app team separately (CloudKit uses a different storage backend).

---

## API Reference

### `GoogleDriveProvider`

```ts
interface GoogleDriveConfig {
  accessToken: string;
  filePath?: string;      // default: "wallet_backup_key.json"
  cloudEmail?: string;
  timeout?: number;       // default: 30000
}
```

- File stored in Google Drive `appDataFolder`
- Compatible with backups from `@tetherto/wdk-backup-cloud-react-native` on Android

### `CloudKitProvider`

```ts
interface CloudKitConfig {
  containerIdentifier: string;
  environment: "development" | "production";
  zoneName?: string;           // default: "_defaultZone"
  recordName?: string;         // default: "wallet_backup_key"
  recordType?: string;         // default: "WalletBackup"
  cloudEmail?: string;
  getCloudKitAuth: () => Promise<CloudKitAuthContext>;
  maxSyncRetries?: number;
  syncRetryDelayMs?: number;
  timeout?: number;
}
```

### `CloudBackup`

| Method | Description |
| ------ | ----------- |
| `uploadEncryptedKey(key, metadata)` | Validate + upload |
| `downloadEncryptedKey()` | Download or `null` |
| `deleteBackup()` | Idempotent delete |
| `isAvailable()` | Lightweight probe |
| `exists()` | Existence check without download |

---

## Stored payload

Both providers use the same `CloudEncryptionKeyFile` shape:

```json
{
  "encryptionKey": "<encrypted_wallet_master_key>",
  "savedAt": "2026-02-25T00:00:00.000Z",
  "platform": "ios",
  "version": 1,
  "cloudEmail": "user@example.com"
}
```

---

## Security

- Never logs encrypted keys or auth tokens
- No local persistence — in-request lifecycle only
- No OAuth flows in the SDK
- CloudKit uses the **private** database only
- Error messages must not include `Authorization` headers or token values

---

## Build

```bash
npm run build
npm run lint
npm run typecheck
npm test
npm run test:coverage
```

---

## License

Apache-2.0
