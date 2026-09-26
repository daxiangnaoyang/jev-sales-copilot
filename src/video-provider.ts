import type { ProductVideoGeneration } from "./types";

export const VIDEO_API_BASE = "https://ark.cn-beijing.volces.com/api/v3";
export const DEFAULT_VIDEO_MODEL = "doubao-seedance-2-5-260628";
const MAX_REFERENCE_IMAGES = 12;
const MAX_PROMPT_CHARS = 12_000;
const MAX_IMAGE_DATA_CHARS = 10 * 1024 * 1024;

export interface VideoTaskResponse {
  id: string;
  status: ProductVideoGeneration["status"];
  videoUrl?: string;
  error?: string;
}

function validateApiKey(apiKey: string) {
  if (!apiKey.trim() || apiKey.length > 4096) throw new Error("请先在模型与服务配置中填写有效的火山方舟 API Key。");
}

function redact(value: string, apiKey: string): string {
  return value.replaceAll(apiKey, "[已隐藏]").slice(0, 700);
}

async function readJson(response: Response, apiKey: string): Promise<Record<string, unknown>> {
  const body = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object") payload = parsed as Record<string, unknown>;
  } catch { /* handled below */ }
  if (!response.ok) {
    throw new Error(`视频 API 返回 ${response.status}：${redact(JSON.stringify(payload.error ?? payload.message ?? body.slice(0, 400)), apiKey)}`);
  }
  return payload;
}

async function arkFetch(path: string, apiKey: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(`${VIDEO_API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: { Authorization: `Bearer ${apiKey.trim()}`, ...(init.headers ?? {}) },
    });
    return await readJson(response, apiKey);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("视频 API 返回")) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("aborted")) throw new Error("视频 API 请求超时；请检查任务状态后再重试。不会自动重复创建生成任务。");
    throw new Error(`无法连接火山方舟视频 API：${message}。若浏览器跨域策略拦截，请使用桌面 App。`);
  } finally {
    window.clearTimeout(timer);
  }
}

export function buildSeedanceRequest(args: {
  model: string;
  prompt: string;
  ratio: "9:16" | "16:9";
  images: string[];
}): Record<string, unknown> {
  if (!args.model.trim() || !/^[a-zA-Z0-9._-]{1,256}$/.test(args.model.trim())) throw new Error("视频模型 ID 无效。");
  if (!args.prompt.trim() || args.prompt.length > MAX_PROMPT_CHARS) throw new Error("视频分镜提示词为空或超过 12,000 字。");
  if (!new Set(["9:16", "16:9"]).has(args.ratio)) throw new Error("当前视频方向不支持；请选择 9:16 或 16:9。");
  if (args.images.length > MAX_REFERENCE_IMAGES || args.images.some((image) => !/^data:image\/(jpeg|png|webp);base64,/i.test(image))
      || args.images.reduce((size, image) => size + image.length, 0) > MAX_IMAGE_DATA_CHARS) {
    throw new Error("参考图片格式/数量超出范围；最多 12 张 JPEG、PNG 或 WebP 图片。未提交生成任务。");
  }
  return {
    model: args.model.trim(),
    content: [
      { type: "text", text: args.prompt.trim() },
      ...args.images.map((url) => ({ type: "image_url", image_url: { url }, role: "reference_image" })),
    ],
    ratio: args.ratio,
    duration: 15,
    resolution: "720p",
    generate_audio: true,
    watermark: false,
  };
}

function taskResponse(payload: Record<string, unknown>): VideoTaskResponse {
  const id = typeof payload.id === "string" ? payload.id : "";
  if (!id || !/^[a-zA-Z0-9_-]{1,160}$/.test(id)) throw new Error("视频 API 返回的任务 ID 无效。");
  const rawStatus = typeof payload.status === "string" ? payload.status : "unknown";
  const status: ProductVideoGeneration["status"] = ["queued", "running", "succeeded", "failed", "expired", "cancelled"].includes(rawStatus)
    ? rawStatus as ProductVideoGeneration["status"]
    : "unknown";
  const content = payload.content && typeof payload.content === "object" ? payload.content as Record<string, unknown> : {};
  const errorObject = payload.error && typeof payload.error === "object" ? payload.error as Record<string, unknown> : undefined;
  return {
    id,
    status,
    videoUrl: typeof content.video_url === "string" && content.video_url.startsWith("https://") ? content.video_url : undefined,
    error: typeof errorObject?.message === "string" ? errorObject.message.slice(0, 700) : undefined,
  };
}

export async function checkSeedanceProvider(apiKey: string): Promise<string[]> {
  validateApiKey(apiKey);
  const payload = await arkFetch("/models", apiKey);
  const data = Array.isArray(payload.data) ? payload.data : [];
  return data.flatMap((item) => item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string"
    ? [(item as { id: string }).id]
    : []).slice(0, 100);
}

export async function createSeedanceTask(args: {
  apiKey: string;
  model: string;
  prompt: string;
  ratio: "9:16" | "16:9";
  images: string[];
}): Promise<VideoTaskResponse> {
  validateApiKey(args.apiKey);
  const payload = buildSeedanceRequest(args);
  const response = await arkFetch("/contents/generations/tasks", args.apiKey, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return taskResponse(response);
}

export async function getSeedanceTask(apiKey: string, taskId: string): Promise<VideoTaskResponse> {
  validateApiKey(apiKey);
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(taskId)) throw new Error("视频任务 ID 无效。");
  const response = await arkFetch(`/contents/generations/tasks/${encodeURIComponent(taskId)}`, apiKey);
  return taskResponse(response);
}
