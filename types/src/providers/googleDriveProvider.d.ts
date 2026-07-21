/**
 * @implements {CloudProvider}
 */
export class GoogleDriveProvider implements CloudProvider {
    /**
     * @param {GoogleDriveConfig} config
     */
    constructor(config: GoogleDriveConfig);
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
export type CloudProvider = import("../types.js").CloudProvider;
export type GoogleDriveConfig = import("../types.js").GoogleDriveConfig;
