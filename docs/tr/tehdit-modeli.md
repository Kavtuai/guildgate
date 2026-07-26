# Tehdit modeli

## Korunan varlıklar

Discord bot/OAuth credential'ları, session kayıtları, sunucu ayarları, audit geçmişi, owner politikaları, realtime olayları, operasyon metrikleri ve paket yayın bütünlüğü korunur.

## Dikkate alınan saldırılar

Kimliksiz istek, CSRF, cross-site socket, OAuth replay, duplicate write, stale revision, eski idempotency worker, süresi dolan lock sahibi, yavaş realtime istemcisi, secret sızıntısı, düşük yetkili veri tabanı hesabı ve yayın zinciri saldırısı dikkate alınır.

## Kontroller

- HttpOnly opak session cookie ve sunucuda token hash'i
- rotation, expiry, idle expiry, revocation ve atomik session sınırı
- exact-origin ve session'a bağlı CSRF
- tek kullanımlık tarayıcıya bağlı OAuth state
- sunucu taraflı kaynak ve Discord yetkisi
- reservation sahipli idempotency ve optimistic revision
- yenilenen lease ve fencing token
- katı yanıt süresi, bounded retry ve circuit breaker
- transaction kesinliği ve savepoint
- kanal yetkisi, payload/rate/backpressure ve session revalidation
- transaction outbox ve claim lease
- audit redaction, bounded serialization, protected GitHub environment, OIDC npm yayını ve provenance

## Temel kurallar

Commit edilen domain yazımı gözlemci hatası nedeniyle rollback sayılmaz. Eski idempotency worker yeni reservation kaydını tamamlayamaz. Süresi dolan lease sahibi durable fencing kontrolü olmadan güvenilir değildir. Outbox olayı birden fazla kez teslim edilebilir ve event ID ile deduplicate edilmelidir.

## Sınırlar

GuildGate ele geçirilmiş hostu, yanlış TLS/firewall kurulumunu, aşırı yetkili veri tabanı rolünü, sızan uygulama secret'ını veya ürüne özel authorization politikasını düzeltemez. Reverse proxy trust ve Discord ürün politikası uygulamanın sorumluluğudur.

Dahil edilen inceleme bakımcı incelemesidir; bağımsız üçüncü taraf denetimi iddiası taşımaz. Harici inceleme kapsamı `EXTERNAL_REVIEW_GUIDE.md` dosyasındadır.
