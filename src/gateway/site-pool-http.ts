import type { IncomingMessage, ServerResponse } from "node:http";
import { getSitePoolQrTask } from "../site-pool/store.js";
import { renderQrPngBase64 } from "../web/qr-image.js";

const SITE_POOL_QR_IMAGE_RE = /^\/api\/site-pool\/accounts\/([^/]+)\/qr\/image\/?$/;
const DATA_URL_IMAGE_RE = /^data:image\/([a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=]+)$/;

function sendPlain(res: ServerResponse, status: number, message: string) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(message);
}

function parseImageDataUrl(dataUrl: string): { contentType: string; bytes: Buffer } | null {
  const match = DATA_URL_IMAGE_RE.exec(dataUrl.trim());
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return {
    contentType: `image/${match[1].toLowerCase()}`,
    bytes: Buffer.from(match[2], "base64"),
  };
}

function decodeAccountId(raw: string): string | null {
  try {
    const decoded = decodeURIComponent(raw).trim();
    return decoded || null;
  } catch {
    return null;
  }
}

export async function handleSitePoolHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const match = SITE_POOL_QR_IMAGE_RE.exec(url.pathname);
  if (!match?.[1]) {
    return false;
  }
  if ((req.method ?? "GET").toUpperCase() !== "GET") {
    sendPlain(res, 405, "Method Not Allowed");
    return true;
  }

  const accountId = decodeAccountId(match[1]);
  if (!accountId) {
    sendPlain(res, 400, "Invalid account id");
    return true;
  }

  const task = await getSitePoolQrTask(accountId);
  if (!task) {
    sendPlain(res, 404, "QR task not found");
    return true;
  }
  if (task.status === "expired") {
    sendPlain(res, 410, "QR expired");
    return true;
  }

  const imageData = typeof task.qrImageUrl === "string" ? parseImageDataUrl(task.qrImageUrl) : null;
  if (imageData) {
    res.statusCode = 200;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", imageData.contentType);
    res.end(imageData.bytes);
    return true;
  }

  if (typeof task.qrRawText === "string" && task.qrRawText.trim()) {
    const b64 = await renderQrPngBase64(task.qrRawText.trim());
    res.statusCode = 200;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "image/png");
    res.end(Buffer.from(b64, "base64"));
    return true;
  }

  sendPlain(res, 404, "QR image unavailable");
  return true;
}
