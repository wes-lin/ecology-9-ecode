import type { EcodeImportAppOperations } from './client';
import { getEcodeApiError } from './api-response';

export type EcodeAppPackagePublisher = {
  uploadFile(localPath: string): Promise<Response>;
  importApps(fileId: string | number, operations: EcodeImportAppOperations): Promise<Response>;
  setPreStateOrder?(appId: string, preStateOrder: number): Promise<unknown>;
};

export type EcodePublishApp = {
  appId: string;
  appStatus: string;
  appPreStateOrder?: number;
};

export type EcodeAppPackagePublishResult = {
  appIds: string[];
  fileId: string | number;
};

async function readUploadedFileId(response: Response): Promise<string | number> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Upload failed: server returned an invalid response (HTTP ${response.status}).`);
  }

  if (!response.ok) throw new Error(`Upload failed: HTTP ${response.status}.`);
  const apiError = getEcodeApiError(payload);
  if (apiError) throw new Error(apiError);

  const data =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as { data?: unknown }).data
      : undefined;
  const fileId =
    data && typeof data === 'object' && !Array.isArray(data) ? (data as { fileid?: unknown }).fileid : undefined;
  if ((typeof fileId !== 'string' && typeof fileId !== 'number') || String(fileId).trim() === '') {
    throw new Error('Upload succeeded but response data.fileid is missing.');
  }
  return fileId;
}

function createImportOperations(apps: EcodePublishApp[]): { appIds: string[]; operations: EcodeImportAppOperations } {
  if (apps.length === 0) throw new Error('At least one eCode app is required for publishing.');

  const appIds: string[] = [];
  const operations: EcodeImportAppOperations = {};
  for (const app of apps) {
    if (!app || typeof app.appId !== 'string' || !app.appId.trim()) {
      throw new Error('Each published eCode app must have a non-empty app id.');
    }
    if (Object.hasOwn(operations, app.appId)) {
      throw new Error(`Duplicate published eCode app id "${app.appId}".`);
    }
    appIds.push(app.appId);
    operations[app.appId] = {
      cover: 'y',
      autoRelease: app.appStatus === 'released' ? 'y' : 'n',
      coverConfig: 'n',
    };
  }
  return { appIds, operations };
}

export async function publishAppUpgradePackage(
  client: EcodeAppPackagePublisher,
  archivePath: string,
  apps: EcodePublishApp[]
): Promise<EcodeAppPackagePublishResult> {
  const { appIds, operations } = createImportOperations(apps);
  const uploadResponse = await client.uploadFile(archivePath);
  const fileId = await readUploadedFileId(uploadResponse);
  const importResponse = await client.importApps(fileId, operations);
  if (!importResponse.ok) throw new Error(`Import failed: HTTP ${importResponse.status}.`);

  const appsWithPreStateOrder = apps.filter((app) => app.appPreStateOrder !== undefined);
  if (appsWithPreStateOrder.length > 0 && !client.setPreStateOrder) {
    throw new Error('Published app preload order cannot be restored: client.setPreStateOrder is unavailable.');
  }
  for (const app of appsWithPreStateOrder) {
    await client.setPreStateOrder!(app.appId, app.appPreStateOrder!);
  }

  return { appIds, fileId };
}
