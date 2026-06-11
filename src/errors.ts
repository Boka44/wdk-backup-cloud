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
 * Typed error hierarchy — all errors carry a machine-readable `code`
 * discriminant so callers can branch without instanceof chains.
 *
 * Security: error messages MUST NOT contain encrypted key material.
 */

// ---------------------------------------------------------------------------
// Discriminant union
// ---------------------------------------------------------------------------

export type CloudErrorCode =
  | "CLOUD_UNAVAILABLE"
  | "CLOUD_AUTH_ERROR"
  | "CLOUD_STORAGE_ERROR"
  | "CLOUD_VALIDATION_ERROR";

// ---------------------------------------------------------------------------
// Base class
// ---------------------------------------------------------------------------

abstract class CloudError extends Error {
  abstract readonly code: CloudErrorCode;

  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    // Fix prototype chain for transpiled classes
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = new.target.name;
  }
}

// ---------------------------------------------------------------------------
// Concrete errors
// ---------------------------------------------------------------------------

/**
 * The cloud service is unreachable or not enabled on the device
 * (e.g., CloudKit unavailable, no network connectivity).
 */
export class CloudUnavailableError extends CloudError {
  readonly code = "CLOUD_UNAVAILABLE" as const;

  constructor(message = "Cloud storage is unavailable", cause?: unknown) {
    super(message, cause);
  }
}

/**
 * The caller's credentials are invalid or expired
 * (e.g., Google OAuth token revoked, CloudKit user not signed in).
 */
export class CloudAuthError extends CloudError {
  readonly code = "CLOUD_AUTH_ERROR" as const;

  constructor(message = "Cloud authentication failed", cause?: unknown) {
    super(message, cause);
  }
}

/**
 * A read, write, or delete operation failed at the storage layer
 * (e.g., quota exceeded, I/O error, malformed server response).
 */
export class CloudStorageError extends CloudError {
  readonly code = "CLOUD_STORAGE_ERROR" as const;

  constructor(message = "Cloud storage operation failed", cause?: unknown) {
    super(message, cause);
  }
}

/**
 * The caller supplied an invalid argument to the SDK
 * (e.g., empty encrypted key, corrupt downloaded payload).
 */
export class CloudValidationError extends CloudError {
  readonly code = "CLOUD_VALIDATION_ERROR" as const;

  constructor(message = "Cloud backup validation failed", cause?: unknown) {
    super(message, cause);
  }
}
