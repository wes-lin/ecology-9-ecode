import type { EcodeDevServerConfig } from '../config/ecodeDevServer';
import type { EcodeEnvironmentConfig } from '../config/ecodeEnvironment';

export type EditableEcodeDevServerConfig = Omit<EcodeDevServerConfig, 'port'> & { port: number | string };

export type EnvironmentSettingsRequest =
  | { command: 'ready' }
  | {
      command: 'save';
      environments: EcodeEnvironmentConfig[];
      devServer: EditableEcodeDevServerConfig;
      activeIndex: number;
    }
  | { command: 'browseLocalDir'; index: number }
  | { command: 'confirmDelete'; index: number; name: string }
  | { command: 'confirmDiscard' };

export type EnvironmentSettingsResponse =
  | {
      type: 'state' | 'saved';
      environments: EcodeEnvironmentConfig[];
      devServer: EcodeDevServerConfig;
      activeIndex: number;
    }
  | { type: 'localDir'; index: number; localDir: string }
  | { type: 'deleteConfirmed'; index: number }
  | { type: 'discardConfirmed' }
  | { type: 'error'; message: string };
