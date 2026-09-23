import type {
  CustomerMessage,
  CustomerConversation,
  CustomerStrategy,
  SalesDecision,
  ProductWorkspace,
  ReviewRecord,
} from "./types";

const STORAGE_KEY = "jev-sales-copilot:workspace:v1";

export interface PersistedWorkspace {
  customers: CustomerConversation[];
  selectedCustomerId: string;
  productWorkspace: ProductWorkspace;
  reviewRecords: ReviewRecord[];
  selectedReviewId?: string;
  /** Fields below are read only to migrate workspaces saved by v0.0.1. */
  messages?: CustomerMessage[];
  decision?: SalesDecision;
  strategy?: CustomerStrategy;
}

export function loadWorkspace(): Partial<PersistedWorkspace> | undefined {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return undefined;
    const saved = parsed as Partial<PersistedWorkspace>;
    return {
      ...(Array.isArray(saved.customers) ? { customers: saved.customers } : {}),
      ...(typeof saved.selectedCustomerId === "string" ? { selectedCustomerId: saved.selectedCustomerId } : {}),
      ...(Array.isArray(saved.messages) ? { messages: saved.messages } : {}),
      ...(saved.decision && typeof saved.decision === "object" ? { decision: saved.decision } : {}),
      ...(saved.strategy && typeof saved.strategy === "object" ? { strategy: saved.strategy } : {}),
      ...(saved.productWorkspace && typeof saved.productWorkspace === "object" ? { productWorkspace: saved.productWorkspace } : {}),
      ...(Array.isArray(saved.reviewRecords) ? { reviewRecords: saved.reviewRecords } : {}),
      ...(typeof saved.selectedReviewId === "string" ? { selectedReviewId: saved.selectedReviewId } : {}),
    };
  } catch {
    return undefined;
  }
}

export function saveWorkspace(workspace: PersistedWorkspace): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
    return true;
  } catch {
    return false;
  }
}

export async function prepareImageForLocalStorage(file: File): Promise<string> {
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("无法读取图片"));
    reader.onerror = () => reject(new Error("无法读取图片"));
    reader.readAsDataURL(file);
  });

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("图片格式无法识别"));
    element.src = source;
  });

  const maxEdge = 1600;
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前环境无法处理图片");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}
