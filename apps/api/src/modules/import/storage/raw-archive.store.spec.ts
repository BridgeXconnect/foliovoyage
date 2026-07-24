import { describe, expect, it, jest } from "@jest/globals";
import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";

import { R2RawArchiveStore, rawPageKey } from "./raw-archive.store";

describe("rawPageKey", () => {
  it("lays out keys as raw/{source}/{date}/{page}.json", () => {
    expect(rawPageKey({ source: "viator", date: "2026-07-24", page: 1 })).toBe(
      "raw/viator/2026-07-24/1.json",
    );
    expect(rawPageKey({ source: "viator", date: "2026-07-24", page: 42 })).toBe(
      "raw/viator/2026-07-24/42.json",
    );
  });
});

describe("R2RawArchiveStore", () => {
  it("PUTs the raw body to the configured bucket at the page key", async () => {
    const send = jest.fn<S3Client["send"]>().mockResolvedValue({} as never);
    const client = { send } as unknown as S3Client;
    const store = new R2RawArchiveStore(
      {
        endpoint: "https://acct.r2.cloudflarestorage.com",
        bucket: "folio-raw",
        accessKeyId: "id",
        secretAccessKey: "secret",
      },
      client,
    );

    const result = await store.putRawPage(
      { source: "viator", date: "2026-07-24", page: 3 },
      '{"products":[]}',
    );

    expect(result).toEqual({
      bucket: "folio-raw",
      key: "raw/viator/2026-07-24/3.json",
    });
    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect((command as PutObjectCommand).input).toEqual({
      Bucket: "folio-raw",
      Key: "raw/viator/2026-07-24/3.json",
      Body: '{"products":[]}',
      ContentType: "application/json",
    });
  });
});
