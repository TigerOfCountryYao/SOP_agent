export const SITE_POOL_STATUSES = [
  "unknown",
  "active",
  "expiring",
  "expired",
  "reauth_required",
  "locked",
] as const;

export const SITE_POOL_LOGIN_TYPES = [
  "qr",
  "password_2fa",
  "sms",
  "email_code",
  "unknown",
] as const;

export const SITE_POOL_KEEPALIVE_POLICIES = ["off", "until_date", "continuous"] as const;

export type SitePoolStatus = (typeof SITE_POOL_STATUSES)[number];
export type SitePoolLoginType = (typeof SITE_POOL_LOGIN_TYPES)[number];
export type SitePoolKeepalivePolicy = (typeof SITE_POOL_KEEPALIVE_POLICIES)[number];

export type SitePoolAccount = {
  id: string;
  siteKey: string;
  displayName: string;
  browserProfile?: string;
  loginType: SitePoolLoginType;
  status: SitePoolStatus;
  keepalivePolicy: SitePoolKeepalivePolicy;
  keepaliveUntil?: string;
  expiresAt?: string;
  lastCheckAt?: string;
  lastSuccessAt?: string;
  notifyOnExpire: boolean;
  notifyOnQrRequired: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SitePoolEventType =
  | "status_changed"
  | "qr_detected"
  | "login_success"
  | "login_failed"
  | "refresh_failed";

export type SitePoolEvent = {
  id: string;
  siteAccountId: string;
  eventType: SitePoolEventType;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type SitePoolQrTaskStatus = "pending" | "ready" | "expired" | "consumed" | "failed";

export type SitePoolQrTask = {
  id: string;
  siteAccountId: string;
  status: SitePoolQrTaskStatus;
  qrImageUrl?: string;
  qrRawText?: string;
  expiredAt?: string;
  createdAt: string;
};

export type SitePoolStoreFile = {
  version: 1;
  accounts: SitePoolAccount[];
  events: SitePoolEvent[];
  qrTasks: SitePoolQrTask[];
};
