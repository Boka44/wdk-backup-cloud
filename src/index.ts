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
 * Public barrel export — named exports only, no default exports.
 * Tree-shakeable: each import can be individually eliminated by bundlers.
 */

// Core
export { CloudBackup } from "./cloudBackup.js";

// Providers
export { GoogleDriveProvider } from "./providers/googleDriveProvider.js";
export { CloudKitProvider } from "./providers/cloudKitProvider.js";

// Errors (includes CloudErrorCode type)
export {
  CloudAuthError,
  CloudStorageError,
  CloudUnavailableError,
  CloudValidationError,
} from "./errors.js";
export type { CloudErrorCode } from "./errors.js";

// Types
export type {
  CloudEncryptionKeyFile,
  CloudKitAuthContext,
  CloudProvider,
  GoogleDriveConfig,
  CloudKitConfig,
} from "./types.js";
