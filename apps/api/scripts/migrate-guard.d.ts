export function checkMigrateUrls(
  databaseUrl: string | undefined,
  directUrl: string | undefined,
): { ok: true; message: string } | { ok: false; message: string };
