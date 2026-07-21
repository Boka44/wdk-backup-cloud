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
  CloudValidationError
} from '../errors.js'
import { CloudHttpError } from '../http-error.js'

/**
 * @typedef {import('../types.js').CloudEncryptionKeyFile} CloudEncryptionKeyFile
 * @typedef {import('../types.js').CloudKitAuthContext} CloudKitAuthContext
 * @typedef {import('../types.js').CloudProvider} CloudProvider
 * @typedef {import('../types.js').CloudKitConfig} CloudKitConfig
 */

/**
 * @typedef {Object} CloudKitFieldValue
 * @property {string | number} [value]
 */

/**
 * CloudKit record shape (subset of fields we care about).
 *
 * @typedef {Object} CloudKitRecord
 * @property {string} [recordName]
 * @property {string} [recordType]
 * @property {string} [recordChangeTag]
 * @property {string} [reason]
 * @property {Record<string, CloudKitFieldValue>} [fields]
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLOUDKIT_API_BASE = 'https://api.apple-cloudkit.com/database/1'
const DEFAULT_ZONE_NAME = '_defaultZone'
const DEFAULT_RECORD_NAME = 'wallet_backup_key'
const DEFAULT_RECORD_TYPE = 'WalletBackup'
const DEFAULT_MAX_SYNC_RETRIES = 10
const DEFAULT_SYNC_RETRY_DELAY_MS = 1000
const DEFAULT_TIMEOUT_MS = 30000

const BACKUP_FIELD_KEYS = ['encryptionKey', 'savedAt', 'cloudEmail']

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * @implements {CloudProvider}
 */
export class CloudKitProvider {
  /** @type {string} */
  #containerIdentifier
  /** @type {'development' | 'production'} */
  #environment
  /** @type {string} */
  #zoneName
  /** @type {string} */
  #recordName
  /** @type {string} */
  #recordType
  /** @type {string} */
  #cloudEmail
  /** @type {() => Promise<CloudKitAuthContext>} */
  #getCloudKitAuth
  /** @type {typeof globalThis.fetch} */
  #fetchFn = globalThis.fetch.bind(globalThis)
  /** @type {number} */
  #maxSyncRetries
  /** @type {number} */
  #syncRetryDelayMs
  /** @type {number} */
  #timeoutMs

  /**
   * @param {CloudKitConfig} config
   */
  constructor (config) {
    this.#containerIdentifier = config.containerIdentifier
    this.#environment = config.environment
    this.#zoneName = config.zoneName ?? DEFAULT_ZONE_NAME
    this.#recordName = config.recordName ?? DEFAULT_RECORD_NAME
    this.#recordType = config.recordType ?? DEFAULT_RECORD_TYPE
    this.#cloudEmail = config.cloudEmail ?? ''
    this.#getCloudKitAuth = config.getCloudKitAuth
    this.#maxSyncRetries = config.maxSyncRetries ?? DEFAULT_MAX_SYNC_RETRIES
    this.#syncRetryDelayMs =
      config.syncRetryDelayMs ?? DEFAULT_SYNC_RETRY_DELAY_MS
    this.#timeoutMs = config.timeout ?? DEFAULT_TIMEOUT_MS

    if (!Number.isInteger(this.#maxSyncRetries) || this.#maxSyncRetries < 1) {
      throw new CloudValidationError(
        'CloudKitConfig.maxSyncRetries must be an integer >= 1'
      )
    }

    if (!Number.isFinite(this.#syncRetryDelayMs) || this.#syncRetryDelayMs < 0) {
      throw new CloudValidationError(
        'CloudKitConfig.syncRetryDelayMs must be a number >= 0'
      )
    }

    if (!Number.isFinite(this.#timeoutMs) || this.#timeoutMs <= 0) {
      throw new CloudValidationError(
        'CloudKitConfig.timeout must be a number greater than 0'
      )
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * @param {string} encryptedKey
   * @returns {Promise<CloudEncryptionKeyFile>}
   */
  async upload (encryptedKey) {
    await this.#assertAvailable()

    /** @type {CloudEncryptionKeyFile} */
    const payload = {
      encryptionKey: encryptedKey,
      savedAt: new Date().toISOString(),
      cloudEmail: this.#cloudEmail
    }

    try {
      await this.#saveRecord(payload)
    } catch (cause) {
      throw this.#mapError(cause, 'Failed to write backup to CloudKit')
    }

    try {
      const verified = await this.#recordExists()
      if (!verified) {
        throw new CloudStorageError(
          'CloudKit backup failed: record not found after write'
        )
      }
      return payload
    } catch (cause) {
      if (cause instanceof CloudStorageError) throw cause
      throw this.#mapError(cause, 'Failed to verify CloudKit backup')
    }
  }

  /**
   * @returns {Promise<CloudEncryptionKeyFile | null>}
   */
  async download () {
    await this.#assertAvailable()

    const exists = await this.#recordExists()
    if (!exists) return null

    /** @type {unknown} */
    let lastError
    for (let attempt = 1; attempt <= this.#maxSyncRetries; attempt++) {
      try {
        const record = await this.#lookupRecord()
        if (!record) return null
        return this.#recordToPayload(record)
      } catch (cause) {
        lastError = cause
        if (cause instanceof CloudStorageError) throw cause
        if (this.#isAuthError(cause)) {
          throw this.#mapError(cause, 'Failed to read backup from CloudKit')
        }
        if (attempt < this.#maxSyncRetries) {
          await new Promise((resolve) => setTimeout(resolve, this.#syncRetryDelayMs))
        }
      }
    }

    throw this.#mapError(
      lastError,
      `Failed to read backup from CloudKit after ${this.#maxSyncRetries} attempts`
    )
  }

  /**
   * @returns {Promise<void>}
   */
  async delete () {
    await this.#assertAvailable()

    const record = await this.#lookupRecord()
    if (!record) return

    try {
      await this.#deleteRecord(record)
    } catch (cause) {
      if (
        cause instanceof CloudStorageError ||
        cause instanceof CloudAuthError ||
        cause instanceof CloudUnavailableError
      ) {
        throw cause
      }
      throw this.#mapError(cause, 'Failed to delete backup from CloudKit')
    }
  }

  /**
   * @returns {Promise<boolean>}
   */
  async isAvailable () {
    try {
      await this.#probeCloudKit()
      return true
    } catch {
      return false
    }
  }

  /**
   * @returns {Promise<boolean>}
   */
  async exists () {
    try {
      const available = await this.isAvailable()
      if (!available) return false
      return await this.#recordExists()
    } catch {
      return false
    }
  }

  // -------------------------------------------------------------------------
  // CloudKit API helpers
  // -------------------------------------------------------------------------

  /**
   * @param {string} path
   * @param {string} apiToken
   * @returns {string}
   */
  #databaseUrl (path, apiToken) {
    const base = `${CLOUDKIT_API_BASE}/${encodeURIComponent(this.#containerIdentifier)}/${this.#environment}/private/${path}`
    return `${base}?ckAPIToken=${encodeURIComponent(apiToken)}`
  }

  /**
   * @returns {{ zoneName: string }}
   */
  #zoneId () {
    return { zoneName: this.#zoneName }
  }

  /**
   * @param {string} path
   * @param {CloudKitAuthContext} auth
   * @param {unknown} body
   * @param {string} [method]
   * @returns {Promise<Response>}
   */
  async #cloudKitRequest (path, auth, body, method = 'POST') {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs)

    try {
      return await this.#fetchFn(this.#databaseUrl(path, auth.apiToken), {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Apple-CloudKit-Web-Auth-Token': auth.webAuthToken
        },
        body: JSON.stringify(body),
        signal: controller.signal
      })
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') {
        throw new CloudHttpError('network timeout', null)
      }
      if (cause instanceof CloudHttpError) throw cause
      throw new CloudHttpError(
        cause instanceof Error ? cause.message : String(cause),
        null
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * @returns {Promise<void>}
   */
  async #probeCloudKit () {
    const auth = await this.#getCloudKitAuth()
    const response = await this.#cloudKitRequest('records/lookup', auth, {
      records: [
        {
          recordName: this.#recordName,
          desiredKeys: [...BACKUP_FIELD_KEYS]
        }
      ],
      zoneID: this.#zoneId()
    })

    if (response.status === 401 || response.status === 403) {
      throw new CloudHttpError('unauthorized', response.status)
    }

    if (!response.ok) {
      throw await this.#httpError(response, 'CloudKit availability check failed')
    }
  }

  /**
   * @returns {Promise<CloudKitRecord | null>}
   */
  async #lookupRecord () {
    const auth = await this.#getCloudKitAuth()
    const response = await this.#cloudKitRequest('records/lookup', auth, {
      records: [
        {
          recordName: this.#recordName,
          desiredKeys: [...BACKUP_FIELD_KEYS]
        }
      ],
      zoneID: this.#zoneId()
    })

    if (response.status === 401 || response.status === 403) {
      throw new CloudHttpError('unauthorized', response.status)
    }

    if (!response.ok) {
      throw await this.#httpError(response, 'CloudKit record lookup failed')
    }

    const body = await response.json()
    const record = body.records?.[0]
    if (!record || record.reason === 'RECORD_NOT_FOUND') {
      return null
    }
    if (record.reason) {
      throw new CloudHttpError(record.reason, null)
    }
    return record
  }

  /**
   * @returns {Promise<boolean>}
   */
  async #recordExists () {
    const record = await this.#lookupRecord()
    return record !== null
  }

  /**
   * @param {CloudEncryptionKeyFile} payload
   * @returns {Promise<void>}
   */
  async #saveRecord (payload) {
    const auth = await this.#getCloudKitAuth()
    const response = await this.#cloudKitRequest('records/modify', auth, {
      operations: [
        {
          operationType: 'forceUpdate',
          record: {
            recordType: this.#recordType,
            recordName: this.#recordName,
            fields: {
              encryptionKey: { value: payload.encryptionKey },
              savedAt: { value: payload.savedAt },
              cloudEmail: { value: payload.cloudEmail }
            }
          }
        }
      ],
      zoneID: this.#zoneId()
    })

    if (response.status === 401 || response.status === 403) {
      throw new CloudHttpError('unauthorized', response.status)
    }

    if (!response.ok) {
      throw await this.#httpError(response, 'CloudKit record save failed')
    }

    const body = await response.json()
    const result = body.records?.[0]
    if (result?.reason && result.reason !== 'RECORD_CHANGED') {
      throw new CloudHttpError(result.reason, null)
    }
  }

  /**
   * @param {CloudKitRecord} record
   * @returns {Promise<void>}
   */
  async #deleteRecord (record) {
    if (!record.recordChangeTag) {
      throw new CloudStorageError(
        'CloudKit record is missing recordChangeTag required for delete'
      )
    }

    const auth = await this.#getCloudKitAuth()
    const response = await this.#cloudKitRequest('records/modify', auth, {
      operations: [
        {
          operationType: 'delete',
          record: {
            recordType: this.#recordType,
            recordName: this.#recordName,
            recordChangeTag: record.recordChangeTag
          }
        }
      ],
      zoneID: this.#zoneId()
    })

    if (response.status === 404) return

    if (response.status === 401 || response.status === 403) {
      throw new CloudHttpError('unauthorized', response.status)
    }

    if (!response.ok) {
      throw await this.#httpError(response, 'CloudKit record delete failed')
    }
  }

  /**
   * @param {CloudKitRecord} record
   * @returns {CloudEncryptionKeyFile}
   */
  #recordToPayload (record) {
    const fields = record.fields ?? {}
    const encryptionKey = fields.encryptionKey?.value
    const savedAt = fields.savedAt?.value
    const cloudEmail = fields.cloudEmail?.value

    if (
      typeof encryptionKey !== 'string' ||
      typeof savedAt !== 'string' ||
      typeof cloudEmail !== 'string'
    ) {
      throw new CloudStorageError(
        'CloudKit backup payload has an unexpected shape'
      )
    }

    return {
      encryptionKey,
      savedAt,
      cloudEmail
    }
  }

  /**
   * @param {Response} response
   * @param {string} context
   * @returns {Promise<CloudHttpError>}
   */
  async #httpError (response, context) {
    let detail = ''
    try {
      const text = await response.text()
      detail = text.slice(0, 200)
    } catch {
      detail = response.statusText
    }
    return new CloudHttpError(
      `${response.status} ${context}: ${detail}`,
      response.status,
      detail
    )
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * @returns {Promise<void>}
   */
  async #assertAvailable () {
    try {
      await this.#probeCloudKit()
    } catch (cause) {
      if (this.#isAuthError(cause)) {
        throw new CloudAuthError(
          'CloudKit user not signed in — authentication failed',
          cause
        )
      }
      throw new CloudUnavailableError(
        'CloudKit is not available. Ensure the user is signed in and CloudKit is enabled.',
        cause
      )
    }
  }

  /**
   * @param {unknown} cause
   * @returns {boolean}
   */
  #isAuthError (cause) {
    if (cause instanceof CloudHttpError) {
      return cause.status === 401 || cause.status === 403
    }
    return false
  }

  /**
   * @param {unknown} cause
   * @param {string} context
   * @returns {Error}
   */
  #mapError (cause, context) {
    if (cause instanceof CloudHttpError) {
      const status = cause.status
      const reason = cause.message.toUpperCase()

      if (status === 401 || status === 403) {
        return new CloudAuthError(
          `CloudKit user not signed in — ${context}`,
          cause
        )
      }

      if (
        reason.includes('QUOTA') ||
        cause.detail.toLowerCase().includes('quota') ||
        cause.detail.toLowerCase().includes('insufficient storage')
      ) {
        return new CloudStorageError(
          `CloudKit storage quota exceeded — ${context}`,
          cause
        )
      }

      if (
        status === null ||
        status === 429 ||
        status === 502 ||
        status === 503 ||
        status === 504
      ) {
        return new CloudUnavailableError(
          `CloudKit service unavailable — ${context}`,
          cause
        )
      }

      return new CloudStorageError(`${context}: ${cause.message}`, cause)
    }

    const msg =
      cause instanceof Error ? cause.message.toLowerCase() : String(cause)

    return new CloudStorageError(`${context}: ${msg}`, cause)
  }
}
