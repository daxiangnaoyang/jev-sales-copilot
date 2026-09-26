import { createWorker } from "tesseract.js";
import type { BrowserScreenOcrLineInput } from "./browser-screen-reader-utils";

export interface CapturedDisplayFrame {
  imageDataUrl: string;
  width: number;
  height: number;
}

export interface DisplayCaptureRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface OcrProgress {
  status: string;
  progress: number;
}

let workerPromise: ReturnType<typeof createWorker> | undefined;
let reportProgress: (progress: OcrProgress) => void = () => undefined;

export function canCaptureDisplayInBrowser(): boolean {
  return Boolean(navigator.mediaDevices?.getDisplayMedia);
}

export function describeDisplayCaptureError(error: unknown): string {
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
  const message = error instanceof Error ? error.message : String(error);
  const normalizedMessage = message.toLocaleLowerCase();
  if (name === "InvalidStateError" || normalizedMessage.includes("invalid state")) return "浏览器没有打开共享选择器：请把此页面置于前台，并用鼠标直接点击“选择聊天窗口”后重试。自动化点击无法代替浏览器要求的用户手势。";
  if (name === "NotAllowedError" || normalizedMessage.includes("not allowed") || normalizedMessage.includes("permission denied")) return "没有共享聊天窗口：你可能取消了浏览器选择器，或浏览器阻止了屏幕共享；请在前台页面重新点击并选择窗口。";
  if (name === "NotReadableError") return "所选屏幕或窗口暂时不可读取；请关闭其他正在占用屏幕采集的应用后重试。";
  return message || "浏览器未能读取窗口画面；请在前台页面重试。";
}

export async function captureDisplayFrame(): Promise<CapturedDisplayFrame> {
  if (!canCaptureDisplayInBrowser()) {
    throw new Error("当前浏览器不支持屏幕共享；请使用桌面 App，或升级到支持 getDisplayMedia 的浏览器。");
  }

  // Must run directly from a user-initiated click; the browser asks the user to pick a window/screen each time.
  const captureOptions = {
    video: true,
    audio: false,
    selfBrowserSurface: "exclude",
  } as DisplayMediaStreamOptions & { selfBrowserSurface: "exclude" };
  const stream = await navigator.mediaDevices.getDisplayMedia(captureOptions);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  try {
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
      await new Promise<void>((resolve, reject) => {
        video.addEventListener("loadedmetadata", () => resolve(), { once: true });
        video.addEventListener("error", () => reject(new Error("无法读取所选窗口画面。")), { once: true });
      });
    }
    await video.play();
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
    if (video.videoWidth <= 0 || video.videoHeight <= 0) throw new Error("共享窗口没有可读取的画面；请重新选择窗口。");

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法建立本机 OCR 画布。");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return { imageDataUrl: canvas.toDataURL("image/jpeg", 0.92), width: canvas.width, height: canvas.height };
  } finally {
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  }
}

function getOcrWorker(): ReturnType<typeof createWorker> {
  if (!workerPromise) {
    workerPromise = createWorker("chi_sim+eng", undefined, {
      logger: (message) => reportProgress({ status: message.status, progress: message.progress ?? 0 }),
      cacheMethod: "write",
    });
    workerPromise.catch(() => { workerPromise = undefined; });
  }
  return workerPromise;
}

export async function recognizeDisplayRegion(
  imageDataUrl: string,
  region: DisplayCaptureRegion,
  onProgress: (progress: OcrProgress) => void = () => undefined,
): Promise<BrowserScreenOcrLineInput[]> {
  reportProgress = onProgress;
  const worker = await getOcrWorker();
  const image = new Image();
  image.src = imageDataUrl;
  await image.decode();
  const left = Math.min(image.naturalWidth - 1, Math.max(0, Math.floor(region.left)));
  const top = Math.min(image.naturalHeight - 1, Math.max(0, Math.floor(region.top)));
  const width = Math.min(image.naturalWidth - left, Math.max(1, Math.floor(region.width)));
  const height = Math.min(image.naturalHeight - top, Math.max(1, Math.floor(region.height)));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法裁切本机 OCR 区域。");
  context.drawImage(image, left, top, width, height, 0, 0, width, height);
  const result = await worker.recognize(canvas);

  return (result.data.blocks ?? []).flatMap((block) =>
    block.paragraphs.flatMap((paragraph) => paragraph.lines.map((line) => ({
      text: line.text,
      confidence: line.confidence,
      bbox: { ...line.bbox },
    }))),
  );
}
