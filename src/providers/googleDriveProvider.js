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
  CloudValidationError
} from '../errors.js'
import { CloudHttpError } from '../http-error.js'

/**
 * @typedef {import('../types.js').CloudEncryptionKeyFile} CloudEncryptionKeyFile
 * @typedef {import('../types.js').CloudProvider} CloudProvider
 * @typedef {import('../types.js').GoogleDriveConfig} GoogleDriveConfig
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_FILE_PATH = 'wallet_backup_key.json'
const DEFAULT_TIMEOUT_MS = 30000
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3'
const APP_DATA_FOLDER = 'appDataFolder'

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * @implements {CloudProvider}
 */
export class GoogleDriveProvider {
  /** @type {() => Promise<string>} */
  #getAccessToken
  /** @type {string} */
  #filePath
  /** @type {string} */
  #cloudEmail
  /** @type {number} */
  #timeoutMs
  /** @type {typeof globalThis.fetch} */
  #fetchFn = globalThis.fetch.bind(globalThis)

  /**
   * @param {GoogleDriveConfig} config
   */
  constructor (config) {
    if (config.getAccessToken) {
      this.#getAccessToken = config.getAccessToken
    } else if (config.accessToken) {
      const token = config.accessToken
      this.#getAccessToken = async () => token
    } else {
      throw new CloudValidationError(
        'GoogleDriveConfig requires accessToken or getAccessToken'
      )
    }

    this.#filePath = config.filePath ?? DEFAULT_FILE_PATH
    this.#cloudEmail = config.cloudEmail ?? ''
    this.#timeoutMs = config.timeout ?? DEFAULT_TIMEOUT_MS

    if (!Number.isFinite(this.#timeoutMs) || this.#timeoutMs <= 0) {
      throw new CloudValidationError(
        'GoogleDriveConfig.timeout must be a number greater than 0'
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
    /** @type {CloudEncryptionKeyFile} */
    const payload = {
      encryptionKey: encryptedKey,
      savedAt: new Date().toISOString(),
      cloudEmail: this.#cloudEmail
    }

    const content = JSON.stringify(payload)

    try {
      const existingId = await this.#findFileId()
      if (existingId) {
        await this.#updateFile(existingId, content)
      } else {
        await this.#createFile(content)
      }
    } catch (cause) {
      throw this.#mapError(cause, 'Failed to write backup to Google Drive')
    }

    try {
      const verified = await this.#fileExists()
      if (!verified) {
        throw new CloudStorageError(
          'Google Drive backup failed: file not found after write'
        )
      }
      return payload
    } catch (cause) {
      if (cause instanceof CloudStorageError) throw cause
      throw this.#mapError(cause, 'Failed to verify Google Drive backup')
    }
  }

  /**
   * @returns {Promise<CloudEncryptionKeyFile | null>}
   */
  async download () {
    /** @type {string | null} */
    let fileId
    try {
      fileId = await this.#findFileId()
    } catch (cause) {
      if (this.#isNotFoundError(cause)) return null
      throw this.#mapError(cause, 'Failed to check Google Drive file existence')
    }

    if (!fileId) return null

    /** @type {string} */
    let raw
    try {
      raw = await this.#readFileContent(fileId)
    } catch (cause) {
      if (this.#isNotFoundError(cause)) return null
      throw this.#mapError(cause, 'Failed to read backup from Google Drive')
    }

    return this.#parsePayload(raw)
  }

  /**
   * @returns {Promise<void>}
   */
  async delete () {
    /** @type {string | null} */
    let fileId
    try {
      fileId = await this.#findFileId()
    } catch (cause) {
      if (this.#isNotFoundError(cause)) return
      throw this.#mapError(cause, 'Failed to check Google Drive file existence')
    }

    if (!fileId) return

    try {
      await this.#deleteFile(fileId)
    } catch (cause) {
      throw this.#mapError(cause, 'Failed to delete backup from Google Drive')
    }
  }

  /**
   * @returns {Promise<boolean>}
   */
  async isAvailable () {
    try {
      const response = await this.#driveRequest(
        `${DRIVE_API_BASE}/about?fields=user`
      )
      return response.ok
    } catch {
      return false
    }
  }

  /**
   * @returns {Promise<boolean>}
   */
  async exists () {
    try {
      return await this.#fileExists()
    } catch (cause) {
      if (this.#isNotFoundError(cause)) return false
      return false
    }
  }

  // -------------------------------------------------------------------------
  // Drive API helpers
  // -------------------------------------------------------------------------

  /**
   * @param {string} value
   * @returns {string}
   */
  #escapeDriveQueryValue (value) {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  }

  /**
   * @returns {Promise<string | null>}
   */
  async #findFileId () {
    const fileName = this.#filePath.split('/').pop() ?? this.#filePath
    const q = `name='${this.#escapeDriveQueryValue(fileName)}' and '${APP_DATA_FOLDER}' in parents and trashed=false`
    const url = `${DRIVE_API_BASE}/files?spaces=${APP_DATA_FOLDER}&q=${encodeURIComponent(q)}&fields=files(id,name)`
    const response = await this.#driveRequest(url)

    if (response.status === 404) return null

    if (!response.ok) {
      throw await this.#httpError(response, 'Failed to list Google Drive files')
    }

    const body = await response.json()
    return body.files?.[0]?.id ?? null
  }

  /**
   * @returns {Promise<boolean>}
   */
  async #fileExists () {
    const id = await this.#findFileId()
    return id !== null
  }

  /**
   * @param {string} content
   * @returns {Promise<void>}
   */
  async #createFile (content) {
    const fileName = this.#filePath.split('/').pop() ?? this.#filePath
    const boundary = `wdk_backup_${Date.now()}`
    const metadata = JSON.stringify({
      name: fileName,
      parents: [APP_DATA_FOLDER]
    })
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      metadata,
      `--${boundary}`,
      'Content-Type: application/json',
      '',
      content,
      `--${boundary}--`,
      ''
    ].join('\r\n')

    const response = await this.#driveRequest(
      `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart`,
      {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body
      }
    )

    if (!response.ok) {
      throw await this.#httpError(response, 'Failed to create Google Drive file')
    }
  }

  /**
   * @param {string} fileId
   * @param {string} content
   * @returns {Promise<void>}
   */
  async #updateFile (fileId, content) {
    const response = await this.#driveRequest(
      `${DRIVE_UPLOAD_BASE}/files/${fileId}?uploadType=media`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: content
      }
    )

    if (!response.ok) {
      throw await this.#httpError(response, 'Failed to update Google Drive file')
    }
  }

  /**
   * @param {string} fileId
   * @returns {Promise<string>}
   */
  async #readFileContent (fileId) {
    const response = await this.#driveRequest(
      `${DRIVE_API_BASE}/files/${fileId}?alt=media`
    )

    if (response.status === 404) {
      throw new CloudHttpError('404 not found', 404)
    }

    if (!response.ok) {
      throw await this.#httpError(response, 'Failed to download Google Drive file')
    }

    return await response.text()
  }

  /**
   * @param {string} fileId
   * @returns {Promise<void>}
   */
  async #deleteFile (fileId) {
    const response = await this.#driveRequest(
      `${DRIVE_API_BASE}/files/${fileId}`,
      { method: 'DELETE' }
    )

    if (response.status === 404) return

    if (!response.ok) {
      throw await this.#httpError(response, 'Failed to delete Google Drive file')
    }
  }

  /**
   * @param {string} url
   * @param {RequestInit} [init]
   * @returns {Promise<Response>}
   */
  async #driveRequest (url, init = {}) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs)

    try {
      const accessToken = await this.#getAccessToken()
      const headers = new Headers(init.headers)
      headers.set('Authorization', `Bearer ${accessToken}`)
      return await this.#fetchFn(url, {
        ...init,
        headers,
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
   * @param {unknown} cause
   * @returns {boolean}
   */
  #isNotFoundError (cause) {
    if (cause instanceof CloudHttpError) {
      return cause.status === 404
    }
    const msg = cause instanceof Error ? cause.message : String(cause)
    return msg.includes('404') || msg.includes('not found')
  }

  /**
   * @param {unknown} cause
   * @param {string} context
   * @returns {Error}
   */
  #mapError (cause, context) {
    if (cause instanceof CloudHttpError) {
      const status = cause.status

      if (status === 401 || status === 403) {
        return new CloudAuthError(
          `Google Drive authentication failed — ${context}`,
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
          `Google Drive unavailable — ${context}`,
          cause
        )
      }

      if (status === 400) {
        return new CloudStorageError(
          `Google Drive rejected the request (400 Bad Request) — ${context}`,
          cause
        )
      }

      return new CloudStorageError(`${context}: ${cause.message}`, cause)
    }

    const msg =
      cause instanceof Error ? cause.message.toLowerCase() : String(cause)

    return new CloudStorageError(`${context}: ${msg}`, cause)
  }

  /**
   * @param {string} raw
   * @returns {CloudEncryptionKeyFile}
   */
  #parsePayload (raw) {
    /** @type {unknown} */
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch (cause) {
      throw new CloudStorageError(
        'Google Drive backup file contains invalid JSON',
        cause
      )
    }

    if (parsed === null || typeof parsed !== 'object') {
      throw new CloudStorageError(
        'Google Drive backup payload has an unexpected shape'
      )
    }

    const record = /** @type {Record<string, unknown>} */ (parsed)
    if (
      typeof record.encryptionKey !== 'string' ||
      typeof record.savedAt !== 'string' ||
      typeof record.cloudEmail !== 'string'
    ) {
      throw new CloudStorageError(
        'Google Drive backup payload has an unexpected shape'
      )
    }

    return {
      encryptionKey: record.encryptionKey,
      savedAt: record.savedAt,
      cloudEmail: record.cloudEmail
    }
  }
}
