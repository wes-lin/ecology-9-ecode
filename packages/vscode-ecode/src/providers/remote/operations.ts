import type { EcodeClient } from 'ecode-sdk';
import { ActiveEcodeClientProvider } from '../../utils/ecodeClientFactory';
import type { EcodeNode } from '../ecodeNode';

export class RemoteEcodeOperations {
  constructor(private readonly clients: ActiveEcodeClientProvider) {}

  get client(): EcodeClient {
    return this.clients.get();
  }

  requireNodeId(element: EcodeNode): string {
    if (!element.id) throw new Error(`${element.type === 'file' ? 'file' : 'folder'} id is missing.`);
    return element.id;
  }

  async delete(element: EcodeNode): Promise<void> {
    const id = this.requireNodeId(element);
    if (element.businessType === 'type') await this.client.deleteType(id);
    else if (element.type === 'file') await this.client.deleteFile(id);
    else await this.client.deleteFolder(id);
  }

  release(element: EcodeNode): Promise<unknown> {
    return this.client.release(element.appId);
  }

  cancelRelease(element: EcodeNode): Promise<unknown> {
    return this.client.deleteReleaseFile(element.appId);
  }

  setPreload(element: EcodeNode, enabled: boolean): Promise<unknown> {
    return this.client.markFile(this.requireNodeId(element), enabled ? 'pre-state' : undefined);
  }

  setPreloadOrder(element: EcodeNode, order: number): Promise<unknown> {
    return this.client.setPreStateOrder(element.appId, order);
  }

  createApp(parent: EcodeNode, name: string): Promise<unknown> {
    return this.client.addFolder(name, undefined, this.requireNodeId(parent));
  }

  createType(parent: EcodeNode, name: string): Promise<unknown> {
    return this.client.addType(name, this.requireNodeId(parent));
  }

  createFolder(parent: EcodeNode, name: string): Promise<unknown> {
    return this.client.addFolder(name, this.requireNodeId(parent));
  }

  createFile(parent: EcodeNode, name: string, extension: 'js' | 'css' | 'md'): Promise<unknown> {
    return this.client.addFile(this.requireNodeId(parent), name, extension);
  }

  async rename(element: EcodeNode, name: string): Promise<void> {
    const id = this.requireNodeId(element);
    if (element.businessType === 'type') await this.client.updateTypeName(id, name);
    else if (element.type === 'file') await this.client.updateFileName(id, name);
    else await this.client.updateFolderName(id, name);
  }

  async uploadResource(parent: EcodeNode, filePath: string): Promise<void> {
    const response = await this.client.uploadResource(filePath, this.requireNodeId(parent));
    if (!response.ok) throw new Error(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`);
  }

  async updateFile(element: EcodeNode, text: string, isJavaScript: boolean): Promise<void> {
    const response = await this.client.updateFile(this.requireNodeId(element), text, isJavaScript);
    if (!response.ok) throw new Error(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`);
  }

  readContent(element: EcodeNode): Promise<string | Buffer> {
    return element.treeType === 'resource'
      ? this.client.viewResource(element.route)
      : this.client.viewFile(element.id ?? '');
  }
}
