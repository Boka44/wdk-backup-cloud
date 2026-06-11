import { CloudKitProvider } from '../providers/cloudKitProvider';
import {
  CloudAuthError,
  CloudStorageError,
  CloudUnavailableError,
} from '../errors';
import type { CloudEncryptionKeyFile, CloudKitAuthContext } from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ENCRYPTED_KEY = 'encrypted_master_key_hex';
const RECORD_NAME = 'wallet_backup_key';
const METADATA = { version: 1 };

const AUTH: CloudKitAuthContext = {
  apiToken: 'ck-api-token',
  webAuthToken: 'ck-web-auth-token',
};

const VALID_PAYLOAD: CloudEncryptionKeyFile = {
  encryptionKey: ENCRYPTED_KEY,
  savedAt: '2026-02-25T00:00:00.000Z',
  platform: 'ios',
  version: 1,
  cloudEmail: '',
};

const VALID_RECORD = {
  recordName: RECORD_NAME,
  recordType: 'WalletBackup',
  fields: {
    encryptionKey: { value: ENCRYPTED_KEY },
    savedAt: { value: VALID_PAYLOAD.savedAt },
    platform: { value: 'ios' },
    version: { value: 1 },
    cloudEmail: { value: '' },
  },
};

const getCloudKitAuth = jest.fn<Promise<CloudKitAuthContext>, []>();

function makeProvider(overrides?: {
  maxSyncRetries?: number;
  syncRetryDelayMs?: number;
  cloudEmail?: string;
}): CloudKitProvider {
  return new CloudKitProvider({
    containerIdentifier: 'iCloud.com.example.app',
    environment: 'development',
    getCloudKitAuth,
    ...overrides,
  });
}

function mockJson(body: unknown, status = 200): void {
  fetchMock.mockResponseOnce(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockLookupFound(): void {
  mockJson({ records: [VALID_RECORD] });
}

function mockLookupNotFound(): void {
  mockJson({
    records: [{ recordName: RECORD_NAME, reason: 'RECORD_NOT_FOUND' }],
  });
}

function mockModifyOk(): void {
  mockJson({ records: [{ recordName: RECORD_NAME }] });
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.resetMocks();
  getCloudKitAuth.mockResolvedValue(AUTH);
});

// ---------------------------------------------------------------------------
// upload
// ---------------------------------------------------------------------------

describe('CloudKitProvider.upload', () => {
  it('saves a CloudKit record with backup fields', async () => {
    mockLookupNotFound();
    mockModifyOk();
    mockLookupFound();

    await makeProvider().upload(ENCRYPTED_KEY, METADATA);

    const modifyCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes('records/modify'),
    );
    expect(modifyCall).toBeDefined();
    const body = JSON.parse(modifyCall![1]?.body as string) as {
      operations: Array<{ record: { fields: Record<string, unknown> } }>;
    };
    expect(body.operations[0]!.record.fields.encryptionKey).toEqual({
      value: ENCRYPTED_KEY,
    });
  });

  it('throws CloudUnavailableError when CloudKit is not reachable', async () => {
    fetchMock.mockRejectOnce(new Error('network unavailable'));

    await expect(
      makeProvider().upload(ENCRYPTED_KEY, METADATA),
    ).rejects.toBeInstanceOf(CloudUnavailableError);
  });

  it('throws CloudAuthError when CloudKit returns 401', async () => {
    mockJson({ reason: 'unauthorized' }, 401);

    await expect(
      makeProvider().upload(ENCRYPTED_KEY, METADATA),
    ).rejects.toBeInstanceOf(CloudAuthError);
  });

  it('throws CloudStorageError on quota exceeded', async () => {
    mockLookupNotFound();
    fetchMock.mockResponseOnce('insufficient storage quota', { status: 507 });

    await expect(
      makeProvider().upload(ENCRYPTED_KEY, METADATA),
    ).rejects.toBeInstanceOf(CloudStorageError);
  });

  it('throws CloudStorageError when record not found after write', async () => {
    mockLookupNotFound();
    mockModifyOk();
    mockLookupNotFound();

    await expect(
      makeProvider().upload(ENCRYPTED_KEY, METADATA),
    ).rejects.toBeInstanceOf(CloudStorageError);
  });

  it('returns the written payload on success', async () => {
    mockLookupNotFound();
    mockModifyOk();
    mockLookupFound();

    const result = await makeProvider().upload(ENCRYPTED_KEY, METADATA);
    expect(result).not.toBeNull();
    expect(result!.encryptionKey).toBe(ENCRYPTED_KEY);
    expect(result!.platform).toBe('ios');
  });

  it('includes cloudEmail from config', async () => {
    mockLookupNotFound();
    mockModifyOk();
    mockLookupFound();

    await makeProvider({ cloudEmail: 'user@example.com' }).upload(
      ENCRYPTED_KEY,
      METADATA,
    );

    const modifyCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes('records/modify'),
    );
    const body = JSON.parse(modifyCall![1]?.body as string) as {
      operations: Array<{ record: { fields: Record<string, { value: string }> } }>;
    };
    expect(body.operations[0]?.record.fields.cloudEmail?.value).toBe(
      'user@example.com',
    );
  });
});

// ---------------------------------------------------------------------------
// download
// ---------------------------------------------------------------------------

describe('CloudKitProvider.download', () => {
  it('maps android platform from CloudKit record fields', async () => {
    mockLookupNotFound();
    mockLookupFound();
    mockJson({
      records: [
        {
          ...VALID_RECORD,
          fields: { ...VALID_RECORD.fields, platform: { value: 'android' } },
        },
      ],
    });

    const result = await makeProvider().download();
    expect(result?.platform).toBe('android');
  });

  it('returns CloudEncryptionKeyFile for an existing backup', async () => {
    mockLookupNotFound();
    mockLookupFound();
    mockLookupFound();

    const result = await makeProvider().download();
    expect(result).not.toBeNull();
    expect(result!.encryptionKey).toBe(ENCRYPTED_KEY);
  });

  it('returns null when record does not exist', async () => {
    mockLookupNotFound();
    mockLookupNotFound();

    const result = await makeProvider().download();
    expect(result).toBeNull();
  });

  it('retries lookup when it fails initially then succeeds', async () => {
    jest.useFakeTimers();
    mockLookupNotFound();
    mockLookupFound();
    fetchMock
      .mockRejectOnce(new Error('I/O error'))
      .mockResponseOnce(JSON.stringify({ records: [VALID_RECORD] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const downloadPromise = makeProvider().download();
    await jest.advanceTimersByTimeAsync(1000);
    const result = await downloadPromise;
    expect(result).not.toBeNull();
    jest.useRealTimers();
  });

  it('throws CloudStorageError on invalid record shape', async () => {
    mockLookupNotFound();
    mockLookupFound();
    mockJson({
      records: [{ recordName: RECORD_NAME, fields: { version: { value: 1 } } }],
    });

    await expect(makeProvider().download()).rejects.toBeInstanceOf(
      CloudStorageError,
    );
  });

  it('throws CloudAuthError when lookup always fails with auth error', async () => {
    jest.useFakeTimers();
    mockLookupNotFound();
    mockLookupFound();
    fetchMock.mockResponse(JSON.stringify({ reason: 'no account' }), {
      status: 401,
    });

    const resultPromise = makeProvider().download().catch((e: unknown) => e);
    await jest.runAllTimersAsync();
    const error = await resultPromise;
    expect(error).toBeInstanceOf(CloudAuthError);
    jest.useRealTimers();
  });

  it('throws CloudStorageError after all retry attempts are exhausted', async () => {
    jest.useFakeTimers();
    mockLookupNotFound();
    mockLookupFound();
    fetchMock.mockResponse(JSON.stringify({ reason: 'error' }), {
      status: 500,
    });

    const resultPromise = makeProvider().download().catch((e: unknown) => e);
    await jest.runAllTimersAsync();
    const error = await resultPromise;
    expect(error).toBeInstanceOf(CloudStorageError);
    jest.useRealTimers();
  });

  it('respects custom syncRetryDelayMs from config', async () => {
    jest.useFakeTimers();
    mockLookupNotFound();
    mockLookupFound();
    fetchMock
      .mockRejectOnce(new Error('I/O error'))
      .mockResponseOnce(JSON.stringify({ records: [VALID_RECORD] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const provider = makeProvider({ syncRetryDelayMs: 500 });
    const downloadPromise = provider.download();

    await jest.advanceTimersByTimeAsync(499);
    await jest.advanceTimersByTimeAsync(1);

    const result = await downloadPromise;
    expect(result).not.toBeNull();
    jest.useRealTimers();
  });

  it('respects custom maxSyncRetries from config', async () => {
    jest.useFakeTimers();
    mockLookupNotFound();
    mockLookupFound();
    fetchMock.mockResponse(JSON.stringify({ reason: 'error' }), {
      status: 500,
    });

    const resultPromise = makeProvider({ maxSyncRetries: 3 })
      .download()
      .catch((e: unknown) => e);
    await jest.runAllTimersAsync();
    await resultPromise;
    const lookupCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('records/lookup'),
    );
    expect(lookupCalls.length).toBeGreaterThanOrEqual(3);
    jest.useRealTimers();
  });

  it('throws CloudUnavailableError when CloudKit is unavailable', async () => {
    fetchMock.mockRejectOnce(new Error('network unavailable'));

    await expect(makeProvider().download()).rejects.toBeInstanceOf(
      CloudUnavailableError,
    );
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe('CloudKitProvider.delete', () => {
  it('deletes existing record', async () => {
    mockLookupNotFound();
    mockLookupFound();
    mockModifyOk();

    await makeProvider().delete();

    const deleteCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes('records/modify'),
    );
    const body = JSON.parse(deleteCall![1]?.body as string) as {
      operations: Array<{ operationType: string }>;
    };
    expect(body.operations[0]!.operationType).toBe('delete');
  });

  it('is idempotent when delete returns 404', async () => {
    mockLookupNotFound();
    mockLookupFound();
    fetchMock.mockResponseOnce('', { status: 404 });

    await expect(makeProvider().delete()).resolves.toBeUndefined();
  });

  it('is idempotent when record does not exist', async () => {
    mockLookupNotFound();
    mockLookupNotFound();

    await expect(makeProvider().delete()).resolves.toBeUndefined();
    const modifyCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('records/modify'),
    );
    expect(modifyCalls).toHaveLength(0);
  });

  it('throws CloudStorageError when modify returns a failure reason', async () => {
    mockLookupNotFound();
    mockJson({ records: [{ recordName: RECORD_NAME, reason: 'QUOTA_EXCEEDED' }] });

    await expect(
      makeProvider().upload(ENCRYPTED_KEY, METADATA),
    ).rejects.toBeInstanceOf(CloudStorageError);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('records/modify'))).toBe(
      true,
    );
  });

  it('throws CloudStorageError if delete fails', async () => {
    mockLookupNotFound();
    mockLookupFound();
    fetchMock.mockResponseOnce('permission denied', { status: 500 });

    await expect(makeProvider().delete()).rejects.toBeInstanceOf(
      CloudStorageError,
    );
  });

  it('throws CloudUnavailableError when CloudKit is not available', async () => {
    fetchMock.mockRejectOnce(new Error('network unavailable'));

    await expect(makeProvider().delete()).rejects.toBeInstanceOf(
      CloudUnavailableError,
    );
  });
});

// ---------------------------------------------------------------------------
// isAvailable
// ---------------------------------------------------------------------------

describe('CloudKitProvider.isAvailable', () => {
  it('returns true when CloudKit lookup succeeds', async () => {
    mockLookupNotFound();
    await expect(makeProvider().isAvailable()).resolves.toBe(true);
  });

  it('returns false when CloudKit lookup fails', async () => {
    fetchMock.mockRejectOnce(new Error('native failure'));
    await expect(makeProvider().isAvailable()).resolves.toBe(false);
  });

  it('returns false when CloudKit returns 401', async () => {
    mockJson({}, 401);
    await expect(makeProvider().isAvailable()).resolves.toBe(false);
  });
});

// ---------------------------------------------------------------------------
// exists
// ---------------------------------------------------------------------------

describe('CloudKitProvider.exists', () => {
  it('returns true when backup record exists', async () => {
    mockLookupNotFound();
    mockLookupFound();

    await expect(makeProvider().exists()).resolves.toBe(true);
  });

  it('returns false when CloudKit is unavailable', async () => {
    fetchMock.mockRejectOnce(new Error('offline'));
    await expect(makeProvider().exists()).resolves.toBe(false);
  });

  it('returns false when record does not exist', async () => {
    mockLookupNotFound();
    mockLookupNotFound();

    await expect(makeProvider().exists()).resolves.toBe(false);
  });

  it('returns false on error', async () => {
    fetchMock.mockRejectOnce(new Error('crash'));
    await expect(makeProvider().exists()).resolves.toBe(false);
  });
});
