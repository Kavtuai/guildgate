import type { SupportedLocale } from "./types.js";

const messages: Record<SupportedLocale, Record<string, string>> = {
  en: {
    AUTHENTICATION_REQUIRED: "Sign in before continuing.",
    SESSION_EXPIRED: "Your session expired. Sign in again.",
    SESSION_REVOKED: "This session is no longer active.",
    CSRF_INVALID: "The request could not be verified.",
    ORIGIN_NOT_ALLOWED: "This request came from an unapproved origin.",
    GUILD_ACCESS_DENIED: "You cannot manage this server.",
    USER_PERMISSION_MISSING: "Your Discord account does not have the required server permission.",
    BOT_PERMISSION_MISSING: "The bot does not have the permission needed for this operation.",
    BOT_NOT_IN_GUILD: "The bot is not installed in this server.",
    RATE_LIMITED: "Too many requests were sent. Try again shortly.",
    INPUT_INVALID: "Some submitted values are invalid.",
    IDEMPOTENCY_KEY_REQUIRED: "This operation needs an Idempotency-Key header.",
    IDEMPOTENCY_CONFLICT: "This idempotency key was already used with different data.",
    IDEMPOTENCY_INFLIGHT: "The same operation is already running.",
    REVISION_CONFLICT: "These settings changed after you opened the page. Reload and review the latest version.",
    RESOURCE_BUSY: "Another operation is editing the same resource.",
    UPSTREAM_TIMEOUT: "A required service did not respond in time.",
    UPSTREAM_UNAVAILABLE: "A required service is currently unavailable.",
    MAINTENANCE_MODE: "Dashboard changes are temporarily paused.",
    SUBJECT_BLOCKED: "Access to this dashboard has been blocked.",
    OAUTH_STATE_INVALID: "The Discord sign-in request expired or was already used.",
    OAUTH_FAILED: "Discord sign-in could not be completed.",
    CONFIGURATION_ERROR: "GuildGate is not configured correctly.",
    INTERNAL_ERROR: "The request failed unexpectedly.",
  },
  tr: {
    AUTHENTICATION_REQUIRED: "Devam etmeden önce giriş yapın.",
    SESSION_EXPIRED: "Oturumunuz sona erdi. Yeniden giriş yapın.",
    SESSION_REVOKED: "Bu oturum artık etkin değil.",
    CSRF_INVALID: "İstek doğrulanamadı.",
    ORIGIN_NOT_ALLOWED: "İstek izin verilmeyen bir kaynaktan geldi.",
    GUILD_ACCESS_DENIED: "Bu sunucuyu yönetemezsiniz.",
    USER_PERMISSION_MISSING: "Discord hesabınız gerekli sunucu yetkisine sahip değil.",
    BOT_PERMISSION_MISSING: "Bot bu işlem için gereken yetkiye sahip değil.",
    BOT_NOT_IN_GUILD: "Bot bu sunucuda kurulu değil.",
    RATE_LIMITED: "Çok fazla istek gönderildi. Kısa süre sonra yeniden deneyin.",
    INPUT_INVALID: "Gönderilen bazı değerler geçersiz.",
    IDEMPOTENCY_KEY_REQUIRED: "Bu işlem Idempotency-Key başlığı gerektiriyor.",
    IDEMPOTENCY_CONFLICT: "Bu idempotency anahtarı farklı verilerle daha önce kullanıldı.",
    IDEMPOTENCY_INFLIGHT: "Aynı işlem şu anda çalışıyor.",
    REVISION_CONFLICT: "Ayarlar siz sayfayı açtıktan sonra değişti. Güncel sürümü yeniden yükleyin.",
    RESOURCE_BUSY: "Aynı kaynak üzerinde başka bir işlem çalışıyor.",
    UPSTREAM_TIMEOUT: "Gerekli servis zamanında yanıt vermedi.",
    UPSTREAM_UNAVAILABLE: "Gerekli servis şu anda kullanılamıyor.",
    MAINTENANCE_MODE: "Panel değişiklikleri geçici olarak durduruldu.",
    SUBJECT_BLOCKED: "Bu panel için erişim engellendi.",
    OAUTH_STATE_INVALID: "Discord giriş isteğinin süresi doldu veya istek daha önce kullanıldı.",
    OAUTH_FAILED: "Discord girişi tamamlanamadı.",
    CONFIGURATION_ERROR: "GuildGate doğru yapılandırılmamış.",
    INTERNAL_ERROR: "İstek beklenmeyen bir nedenle tamamlanamadı.",
  },
};

export function resolveLocale(value: string | undefined, fallback: SupportedLocale): SupportedLocale {
  if (!value) return fallback;
  return value.toLowerCase().startsWith("tr") ? "tr" : "en";
}

export function messageFor(code: string, locale: SupportedLocale): string {
  return messages[locale][code] ?? messages[locale].INTERNAL_ERROR ?? "The request failed.";
}

export function getMessages(locale: SupportedLocale): Readonly<Record<string, string>> {
  return messages[locale];
}
