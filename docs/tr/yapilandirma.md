# Yapılandırma referansı

GuildGate veri tabanı, route düzeni, Discord erişimi ve arayüz kararlarını uygulamaya bırakır.

## Uygulama

`app` alanında ad, ortam ve ana URL bulunur. Production ortamında HTTPS zorunludur ve localhost origin kabul edilmez.

## Bot sahipleri

`owners` alanı owner action'larını kullanabilen Discord kullanıcı ID'lerini içerir. Boş liste owner erişimini kapatır.

## Dil

Varsayılan dil `en` veya `tr` olabilir. Uygulama hata kodlarına göre kendi mesajlarını verebilir. Mesaj değişse de hata kodu sabit kalır.

## Origin

`security.allowedOrigins` exact origin listesidir. Scheme, host ve port eşleşmelidir. Path veya wildcard kullanılmamalıdır.

## Session

- toplam ömür
- boşta kalma süresi
- token yenileme süresi
- kullanıcı başına session sınırı

Cookie adı, path, secure, sameSite ve maxAge alanları değiştirilebilir. Production varsayılanı secure `__Host-` çerezidir.

## Store

Uygulama `GuildGateStores` verir. PostgreSQL kalıcı kayıtlar için, Redis kısa ömürlü limit/cache/idempotency/lease için kullanılabilir. `composeStores()` farklı backend'leri birleştirir.

## Transaction, realtime ve telemetri

Transaction adapter isteğe bağlıdır. Immediate realtime publisher ayrı verilebilir; outbox `stores.outbox` kullanır. Telemetri hook'ları seçilen izleme sistemine bağlanır.

## Audit

Audit açılıp kapatılabilir, ek gizli alan adları maskelenebilir ve belirli action'lar audit hatasında fail-closed çalıştırılabilir. Domain ile atomik olması gereken audit kaydı veri tabanı transaction'ına yazılmalıdır.

## Action ayarları

Her action authentication, CSRF, parse, resource, rate, yetki, idempotency, revision, concurrency, retry, circuit breaker, transaction, timeout, cache, realtime ve audit davranışını ayrı belirleyebilir.
