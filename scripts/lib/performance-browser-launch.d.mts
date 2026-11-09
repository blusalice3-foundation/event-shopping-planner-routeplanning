export type PerformanceBrowserLaunchOptions = {
  channel?: string;
  headless: boolean;
  args?: string[];
};
export type PerformanceBrowserLaunchMetadata = {
  gpuRequested: boolean;
  browserLaunchArgs: string[];
};
export function resolvePerformanceBrowserLaunchOptions(
  env?: Readonly<Record<string, string | undefined>>,
): PerformanceBrowserLaunchOptions;
export function performanceBrowserLaunchMetadata(
  env?: Readonly<Record<string, string | undefined>>,
): PerformanceBrowserLaunchMetadata;
export function validatePerformanceBrowserLaunchMetadata(
  value: unknown,
  options?: { allowLegacy?: boolean },
): PerformanceBrowserLaunchMetadata | null;
