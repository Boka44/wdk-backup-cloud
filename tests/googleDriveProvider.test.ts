import { GoogleDriveProvider } from '../src/providers/googleDriveProvider';
import {
  CloudAuthError,
  CloudStorageError,
  CloudUnavailableError,
} from '../src/errors';
import type { CloudEncryptionKeyFile } from '../src/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACCESS_TOKEN = 'test_access_token';
const ENCRYPTED_KEY = 'encrypted_master_key_hex';
const DEFAULT_PATH = 'wallet_backup_key.json';
const FILE_ID = 'drive_file_id_123';
const METADATA = { version: 1 };

const VALID_PAYLOAD: CloudEncryptionKeyFile = {
  encryptionKey: ENCRYPTED_KEY,
  savedAt: '2026-02-25T00:00:00.000Z',
  platform: 'android',
  version: 1,
  cloudEmail: '',
};

function makeProvider(config?: {
  filePath?: string;
  cloudEmail?: string;
  timeout?: number;
}): GoogleDriveProvider {
  return new GoogleDriveProvider({
    accessToken: ACCESS_TOKEN,
    ...config,
  });
}

function mockListFiles(files: Array<{ id: string; name: string }> = []): void {
  fetchMock.mockResponseOnce(
    JSON.stringify({ files }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function mockOk(body = '{}'): void {
  fetchMock.mockResponseOnce(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockText(body: string, status = 200): void {
  fetchMock.mockResponseOnce(body, { status });
}

function mockError(status: number, body = 'error'): void {
  fetchMock.mockResponseOnce(body, { status });
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  fetchMock.resetMocks();
});

// ---------------------------------------------------------------------------
// upload
// ---------------------------------------------------------------------------

describe('GoogleDriveProvider.upload', () => {
  it('creates a new file in appDataFolder when none exists', async () => {
    mockListFiles();
    mockOk();
    mockListFiles([{ id: FILE_ID, name: DEFAULT_PATH }]);

    await makeProvider().upload(ENCRYPTED_KEY, METADATA);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const createCall = fetchMock.mock.calls[1]!;
    expect(createCall[0]).toContain('upload/drive/v3/files?uploadType=multipart');
    expect(createCall[1]?.method).toBe('POST');
    const authHeader = (createCall[1]?.headers as Record<string, string>)?.Authorization
      ?? new Headers(createCall[1]?.headers).get('Authorization');
    expect(authHeader).toBe(`Bearer ${ACCESS_TOKEN}`);
  });

  it('writes CloudEncryptionKeyFile JSON content', async () => {
    mockListFiles();
    mockOk();
    mockListFiles([{ id: FILE_ID, name: DEFAULT_PATH }]);

    await makeProvider().upload(ENCRYPTED_KEY, METADATA);

    const createBody = fetchMock.mock.calls[1]![1]?.body as string;
    expect(createBody).toContain('"encryptionKey"');
    expect(createBody).toContain(ENCRYPTED_KEY);
    expect(createBody).toContain('"platform":"android"');
  });

  it('updates existing file when one is found', async () => {
    mockListFiles([{ id: FILE_ID, name: DEFAULT_PATH }]);
    mockOk();
    mockListFiles([{ id: FILE_ID, name: DEFAULT_PATH }]);

    await makeProvider().upload(ENCRYPTED_KEY, METADATA);

    const updateCall = fetchMock.mock.calls[1]!;
    expect(updateCall[0]).toContain(`/files/${FILE_ID}?uploadType=media`);
    expect(updateCall[1]?.method).toBe('PATCH');
  });

  it('throws CloudStorageError when file not found after write', async () => {
    mockListFiles();
    mockOk();
    mockListFiles();

    await expect(
      makeProvider().upload(ENCRYPTED_KEY, METADATA),
    ).rejects.toBeInstanceOf(CloudStorageError);
  });

  it('throws CloudAuthError on auth failure during write', async () => {
    mockListFiles();
    mockError(401, 'unauthorized');

    await expect(
      makeProvider().upload(ENCRYPTED_KEY, METADATA),
    ).rejects.toBeInstanceOf(CloudAuthError);
  });

  it('throws CloudUnavailableError on network failure', async () => {
    fetchMock.mockRejectOnce(new Error('network unavailable'));

    await expect(
      makeProvider().upload(ENCRYPTED_KEY, METADATA),
    ).rejects.toBeInstanceOf(CloudUnavailableError);
  });

  it('returns the written payload on success', async () => {
    mockListFiles();
    mockOk();
    mockListFiles([{ id: FILE_ID, name: DEFAULT_PATH }]);

    const result = await makeProvider().upload(ENCRYPTED_KEY, METADATA);
    expect(result).not.toBeNull();
    expect(result!.encryptionKey).toBe(ENCRYPTED_KEY);
    expect(result!.platform).toBe('android');
  });

  it('uses custom file path basename in Drive query', async () => {
    mockListFiles();
    mockOk();
    mockListFiles([{ id: FILE_ID, name: 'backup.json' }]);

    await makeProvider({ filePath: 'custom/backup.json' }).upload(
      ENCRYPTED_KEY,
      METADATA,
    );

    const listUrl = String(fetchMock.mock.calls[0]![0]);
    expect(listUrl).toContain(encodeURIComponent("name='backup.json'"));
  });

  it('includes cloudEmail from config', async () => {
    mockListFiles();
    mockOk();
    mockListFiles([{ id: FILE_ID, name: DEFAULT_PATH }]);

    await makeProvider({ cloudEmail: 'user@example.com' }).upload(
      ENCRYPTED_KEY,
      METADATA,
    );

    const createBody = fetchMock.mock.calls[1]![1]?.body as string;
    expect(createBody).toContain('user@example.com');
  });
});

// ---------------------------------------------------------------------------
// download
// ---------------------------------------------------------------------------

describe('GoogleDriveProvider.download', () => {
  it('returns CloudEncryptionKeyFile when file exists', async () => {
    mockListFiles([{ id: FILE_ID, name: DEFAULT_PATH }]);
    mockText(JSON.stringify(VALID_PAYLOAD));

    const result = await makeProvider().download();
    expect(result).not.toBeNull();
    expect(result!.encryptionKey).toBe(ENCRYPTED_KEY);
  });

  it('throws when file list fails with server error', async () => {
    mockError(500, 'server error');

    await expect(makeProvider().download()).rejects.toBeInstanceOf(
      CloudStorageError,
    );
  });

  it('returns null when no file exists', async () => {
    mockListFiles();

    const result = await makeProvider().download();
    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null on 404 during download', async () => {
    mockListFiles([{ id: FILE_ID, name: DEFAULT_PATH }]);
    mockError(404, 'not found');

    const result = await makeProvider().download();
    expect(result).toBeNull();
  });

  it('throws CloudStorageError when downloaded payload has wrong shape', async () => {
    mockListFiles([{ id: FILE_ID, name: DEFAULT_PATH }]);
    mockText(JSON.stringify({ version: 2, bad: 'data' }));

    await expect(makeProvider().download()).rejects.toBeInstanceOf(
      CloudStorageError,
    );
  });

  it('throws CloudAuthError on auth failure during read', async () => {
    mockListFiles([{ id: FILE_ID, name: DEFAULT_PATH }]);
    mockError(401, 'unauthorized');

    await expect(makeProvider().download()).rejects.toBeInstanceOf(
      CloudAuthError,
    );
  });

  it('throws CloudStorageError on invalid JSON', async () => {
    mockListFiles([{ id: FILE_ID, name: DEFAULT_PATH }]);
    mockText('not json {{');

    await expect(makeProvider().download()).rejects.toBeInstanceOf(
      CloudStorageError,
    );
  });

  it('throws CloudStorageError on 400 bad request during list', async () => {
    mockError(400, 'malformed query');

    await expect(makeProvider().upload(ENCRYPTED_KEY, METADATA)).rejects.toBeInstanceOf(
      CloudStorageError,
    );
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe('GoogleDriveProvider.delete', () => {
  it('deletes existing file', async () => {
    mockListFiles([{ id: FILE_ID, name: DEFAULT_PATH }]);
    mockOk();

    await makeProvider().delete();

    const deleteCall = fetchMock.mock.calls[1]!;
    expect(deleteCall[0]).toContain(`/files/${FILE_ID}`);
    expect(deleteCall[1]?.method).toBe('DELETE');
  });

  it('throws when existence check fails during delete', async () => {
    mockError(500, 'server error');

    await expect(makeProvider().delete()).rejects.toBeInstanceOf(
      CloudStorageError,
    );
  });

  it('is idempotent when no file exists', async () => {
    mockListFiles();

    await expect(makeProvider().delete()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws CloudAuthError on auth failure during delete', async () => {
    mockListFiles([{ id: FILE_ID, name: DEFAULT_PATH }]);
    mockError(403, 'forbidden');

    await expect(makeProvider().delete()).rejects.toBeInstanceOf(
      CloudAuthError,
    );
  });
});

// ---------------------------------------------------------------------------
// isAvailable
// ---------------------------------------------------------------------------

describe('GoogleDriveProvider.isAvailable', () => {
  it('returns true when Drive about endpoint succeeds', async () => {
    mockOk(JSON.stringify({ user: { displayName: 'Test' } }));
    await expect(makeProvider().isAvailable()).resolves.toBe(true);
  });

  it('returns false on error', async () => {
    fetchMock.mockRejectOnce(new Error('offline'));
    await expect(makeProvider().isAvailable()).resolves.toBe(false);
  });

  it('returns false when about returns non-ok', async () => {
    mockError(503, 'unavailable');
    await expect(makeProvider().isAvailable()).resolves.toBe(false);
  });
});

// ---------------------------------------------------------------------------
// exists
// ---------------------------------------------------------------------------

describe('GoogleDriveProvider.exists', () => {
  it('returns true when file exists', async () => {
    mockListFiles([{ id: FILE_ID, name: DEFAULT_PATH }]);
    await expect(makeProvider().exists()).resolves.toBe(true);
  });

  it('returns false when file does not exist', async () => {
    mockListFiles();
    await expect(makeProvider().exists()).resolves.toBe(false);
  });

  it('returns false on any error', async () => {
    fetchMock.mockRejectOnce(new Error('unknown'));
    await expect(makeProvider().exists()).resolves.toBe(false);
  });
});
