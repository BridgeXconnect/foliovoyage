import { describe, expect, it, jest } from "@jest/globals";
import type { S3Client } from "@aws-sdk/client-s3";

import { R2RawArchiveReader, compareArchiveKeys, productsOf } from "./raw-archive.reader";

const config = { endpoint: "https://r2.test", bucket: "b", accessKeyId: "k", secretAccessKey: "s" };

function bodyOf(text: string) {
  return { Body: { transformToString: async () => text } };
}

type Send = jest.Mock<(command: unknown) => Promise<unknown>>;

function readerWith(send: Send) {
  return new R2RawArchiveReader(config, { send } as unknown as S3Client, 0);
}

describe("R2RawArchiveReader.readPage", () => {
  it("returns the products of a page", async () => {
    const send = jest.fn<(command: unknown) => Promise<unknown>>().mockResolvedValue(bodyOf(JSON.stringify({ products: [{ productCode: "A" }] })));
    await expect(readerWith(send).readPage("raw/viator/2026-09-25/1.json")).resolves.toEqual([{ productCode: "A" }]);
  });

  it("retries when the body read is aborted mid-stream", async () => {
    const send = jest
      .fn<(command: unknown) => Promise<unknown>>()
      .mockResolvedValueOnce({ Body: { transformToString: async () => { throw new Error("aborted"); } } })
      .mockResolvedValueOnce(bodyOf(JSON.stringify({ products: [{ productCode: "A" }] })));
    await expect(readerWith(send).readPage("k")).resolves.toEqual([{ productCode: "A" }]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("gives up with the last error after 5 attempts", async () => {
    const send = jest.fn<(command: unknown) => Promise<unknown>>().mockRejectedValue(new Error("aborted"));
    await expect(readerWith(send).readPage("k")).rejects.toThrow("aborted");
    expect(send).toHaveBeenCalledTimes(5);
  });
});

describe("compareArchiveKeys", () => {
  it("orders newest date first, then ascending page number", () => {
    const keys = [
      "raw/viator/2026-09-13/2.json",
      "raw/viator/2026-09-26/10.json",
      "raw/viator/2026-09-26/2.json",
    ];
    expect(keys.sort(compareArchiveKeys)).toEqual([
      "raw/viator/2026-09-26/2.json",
      "raw/viator/2026-09-26/10.json",
      "raw/viator/2026-09-13/2.json",
    ]);
  });
});

describe("productsOf (BRI-227)", () => {
  it("accepts the crawl's {products} body", () => {
    expect(productsOf({ products: [{ productCode: "A" }] })).toEqual([{ productCode: "A" }]);
  });

  it("accepts the bare array /products/bulk returns", () => {
    expect(productsOf([{ productCode: "A" }, { productCode: "B" }])).toHaveLength(2);
  });

  it.each([null, "x", 7, {}, { products: "no" }])("returns [] for a malformed body %p", (body) => {
    expect(productsOf(body)).toEqual([]);
  });

  it("readPage reads a bare-array archive object", async () => {
    const send = jest.fn<(command: unknown) => Promise<unknown>>().mockResolvedValue(bodyOf(JSON.stringify([{ productCode: "A" }])));
    await expect(readerWith(send).readPage("raw/viator-refetch/2026-10-02/1.json")).resolves.toEqual([{ productCode: "A" }]);
  });
});
