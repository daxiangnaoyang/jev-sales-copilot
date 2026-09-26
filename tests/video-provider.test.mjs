import test from "node:test";
import assert from "node:assert/strict";
import { buildSeedanceRequest, DEFAULT_VIDEO_MODEL } from "../src/video-provider.ts";

test("Seedance request preserves storyboard, product reference images, 15 seconds and ratio", () => {
  const request = buildSeedanceRequest({
    model: DEFAULT_VIDEO_MODEL,
    prompt: "镜头 1：产品主图\n口播：轻巧随行",
    ratio: "9:16",
    images: ["data:image/jpeg;base64,abc"],
  });

  assert.equal(request.model, DEFAULT_VIDEO_MODEL);
  assert.equal(request.ratio, "9:16");
  assert.equal(request.duration, 15);
  assert.equal(request.generate_audio, true);
  assert.deepEqual(request.content, [
    { type: "text", text: "镜头 1：产品主图\n口播：轻巧随行" },
    { type: "image_url", image_url: { url: "data:image/jpeg;base64,abc" }, role: "reference_image" },
  ]);
});

test("Seedance request rejects unsupported ratio, invalid image and oversized prompt before network call", () => {
  const base = { model: DEFAULT_VIDEO_MODEL, prompt: "分镜脚本", ratio: "9:16", images: [] };
  assert.throws(() => buildSeedanceRequest({ ...base, ratio: "4:3" }), /9:16 或 16:9/);
  assert.throws(() => buildSeedanceRequest({ ...base, images: ["https://example.com/product.jpg"] }), /参考图片/);
  assert.throws(() => buildSeedanceRequest({ ...base, prompt: "x".repeat(12_001) }), /12,000/);
});
