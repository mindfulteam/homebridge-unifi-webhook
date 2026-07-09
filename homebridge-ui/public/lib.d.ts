export const DEFAULT_PORT: number;

export interface SensorLike {
  id?: unknown;
  token?: unknown;
  name?: unknown;
}

export interface CachedTokenEntry {
  token: string;
  tokenSource?: 'auto' | 'explicit';
}

export type DisplayTokenResolution =
  | { token: string; source: 'explicit'; pendingRestart: boolean }
  | { token: string; source: 'auto' }
  | { source: 'none' };

export function generateToken(): string;
export function bracketHost(host: string): string;
export function normalizeHost(input: unknown): string;
export function buildUrl(host: string, port: unknown, token: string): string;
export function sensorKey(sensor: SensorLike | undefined): string | undefined;
export function cachedSensorTokens(accessories: unknown, pluginName?: string): Map<string, CachedTokenEntry>;
export function resolveDisplayToken(sensor: SensorLike | undefined, byKey: Map<string, CachedTokenEntry>): DisplayTokenResolution;
