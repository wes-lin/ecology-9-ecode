import * as vscode from 'vscode';
import type { EcodeTreeDataProvider } from './treeDataProvider';

export class EcodeFileDecorationProvider implements vscode.FileDecorationProvider {
  private _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

  constructor(private readonly treeDataProvider: EcodeTreeDataProvider) {}

  provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
    if (uri.scheme !== 'ecode') return undefined;

    const status = this.treeDataProvider.getFileSyncStatus(uri);
    if (status === 'modified') {
      return {
        badge: 'M',
        tooltip: 'Modified',
        color: new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'),
      };
    }
    if (status === 'untracked') {
      return {
        badge: 'U',
        tooltip: 'Untracked',
        color: new vscode.ThemeColor('gitDecoration.untrackedResourceForeground'),
      };
    }
    return undefined;
  }

  refresh(uri?: vscode.Uri): void {
    this._onDidChangeFileDecorations.fire(uri);
  }
}
