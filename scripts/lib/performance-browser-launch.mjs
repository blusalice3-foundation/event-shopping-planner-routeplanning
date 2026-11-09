const gpuArguments = Object.freeze([
  "--enable-gpu",
  "--disable-accelerated-2d-canvas",
]);

export function resolvePerformanceBrowserLaunchOptions(env = {}) {
  const requested = env.PERFORMANCE_ENABLE_GPU;
  if (requested !== undefined && requested !== "0" && requested !== "1") {
    throw new Error("PERFORMANCE_ENABLE_GPU must be unset, 0, or 1.");
  }
  return {
    channel: env.PERFORMANCE_BROWSER_CHANNEL || undefined,
    headless: env.PERFORMANCE_HEADED !== "1",
    ...(requested === "1" ? { args: [...gpuArguments] } : {}),
  };
}

export function performanceBrowserLaunchMetadata(env = {}) {
  const options = resolvePerformanceBrowserLaunchOptions(env);
  return {
    gpuRequested: env.PERFORMANCE_ENABLE_GPU === "1",
    browserLaunchArgs: options.args ? [...options.args] : [],
  };
}

export function validatePerformanceBrowserLaunchMetadata(
  value,
  { allowLegacy = true } = {},
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Browser launch metadata must be an object.");
  }
  const hasRequested = Object.hasOwn(value, "gpuRequested");
  const hasArgs = Object.hasOwn(value, "browserLaunchArgs");
  if (!hasRequested && !hasArgs && allowLegacy) return null;
  if (
    !hasRequested ||
    !hasArgs ||
    typeof value.gpuRequested !== "boolean" ||
    !Array.isArray(value.browserLaunchArgs)
  ) {
    throw new Error("Browser launch metadata is missing or malformed.");
  }
  const expected = value.gpuRequested ? gpuArguments : [];
  if (
    value.browserLaunchArgs.length !== expected.length ||
    !expected.every(
      (argument, index) => value.browserLaunchArgs[index] === argument,
    )
  ) {
    throw new Error("Browser launch GPU request and arguments differ.");
  }
  return {
    gpuRequested: value.gpuRequested,
    browserLaunchArgs: [...expected],
  };
}
