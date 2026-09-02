import type * as vscode from 'vscode';
import type { EcodeNode } from '../ecodeNode';

export class RemoteDocumentStore {
  private readonly contents = new Map<string, Uint8Array>();
  private readonly writableFiles = new Map<string, EcodeNode>();
  private readonly timestamps = new Map<string, { ctime: number; mtime: number }>();

  clear(): void {
    this.contents.clear();
    this.writableFiles.clear();
    this.timestamps.clear();
  }

  open(uri: vscode.Uri, content: string | Buffer | Uint8Array, writableElement?: EcodeNode): void {
    const key = this.key(uri);
    const now = Date.now();
    const previous = this.timestamps.get(key);
    this.contents.set(key, toBytes(content));
    this.timestamps.set(key, { ctime: previous?.ctime ?? now, mtime: now });
    if (writableElement) this.writableFiles.set(key, writableElement);
    else this.writableFiles.delete(key);
  }

  close(uri: vscode.Uri): void {
    const key = this.key(uri);
    this.contents.delete(key);
    this.writableFiles.delete(key);
    this.timestamps.delete(key);
  }

  getContent(uri: vscode.Uri): Uint8Array | undefined {
    return this.contents.get(this.key(uri));
  }

  setContent(uri: vscode.Uri, content: Uint8Array): void {
    const key = this.key(uri);
    const now = Date.now();
    const previous = this.timestamps.get(key);
    this.contents.set(key, Uint8Array.from(content));
    this.timestamps.set(key, { ctime: previous?.ctime ?? now, mtime: now });
  }

  getTimestamps(uri: vscode.Uri): { ctime: number; mtime: number } | undefined {
    return this.timestamps.get(this.key(uri));
  }

  isWritable(uri: vscode.Uri): boolean {
    return this.writableFiles.has(this.key(uri));
  }

  getWritableElement(uri: vscode.Uri): EcodeNode | undefined {
    return this.writableFiles.get(this.key(uri));
  }

  private key(uri: vscode.Uri): string {
    return uri.toString();
  }
}

function toBytes(content: string | Buffer | Uint8Array): Uint8Array {
  if (content instanceof Uint8Array) return Uint8Array.from(content);
  return Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
}
