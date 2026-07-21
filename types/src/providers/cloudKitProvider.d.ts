/**
 * @implements {CloudProvider}
 */
export class CloudKitProvider implements CloudProvider {
    /**
     * @param {CloudKitConfig} config
     */
    constructor(config: CloudKitConfig);
    /**
     * @param {string} encryptedKey
     * @returns {Promise<CloudEncryptionKeyFile>}
     */
    upload(encryptedKey: string): Promise<CloudEncryptionKeyFile>;
    /**
     * @returns {Promise<CloudEncryptionKeyFile | null>}
     */
    download(): Promise<CloudEncryptionKeyFile | null>;
    /**
     * @returns {Promise<void>}
     */
    delete(): Promise<void>;
    /**
     * @returns {Promise<boolean>}
     */
    isAvailable(): Promise<boolean>;
    /**
     * @returns {Promise<boolean>}
     */
    exists(): Promise<boolean>;
    #private;
}
export type CloudEncryptionKeyFile = import("../types.js").CloudEncryptionKeyFile;
export type CloudKitAuthContext = import("../types.js").CloudKitAuthContext;
export type CloudProvider = import("../types.js").CloudProvider;
export type CloudKitConfig = import("../types.js").CloudKitConfig;
export type CloudKitFieldValue = {
    value?: string | number;
};
/**
 * CloudKit record shape (subset of fields we care about).
 */
export type CloudKitRecord = {
    recordName?: string;
    recordType?: string;
    recordChangeTag?: string;
    reason?: string;
    fields?: Record<string, CloudKitFieldValue>;
};
