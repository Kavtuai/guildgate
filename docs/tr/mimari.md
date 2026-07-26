# Mimari

GuildGate politika, transport, Discord erişimi, veri saklama, telemetri ve gösterim katmanlarını ayırır. İsteğe bağlı paketler uygulamanın seçtiği küçük arayüzlerin arkasında kalır.

## Ana bileşenler

1. Kernel; session, origin, CSRF, bakım, block, rate, yetki, idempotency, revision, lease, timeout, transaction, cache, audit ve realtime kurallarını uygular.
2. Session manager ham token yerine hash saklar; süre, boşta kalma, yenileme, sayı sınırı ve iptali denetler.
3. Discord OAuth istemcisi tek kullanımlık ve tarayıcıya bağlı state kullanır; credential kayıtları şifrelenir.
4. Discord yetki katmanı kullanıcı ve bot izinlerini `bigint` ile ayrı kontrol eder.
5. Store sözleşmeleri memory, Redis, PostgreSQL veya uygulamaya özel servisleri bağlar.
6. Transaction adapter aynı backend context'ini ve commit/rollback callback'lerini sağlar.
7. Fastify, Express ve Hono handler'ları ortak request envelope üretir.
8. Realtime hub bağlantıyı ve aboneliği doğrular; adapter'lar WebSocket, Socket.IO ve SSE taşır.
9. Outbox worker commit edilmiş olayları claim ederek yayınlar.
10. Operator action'ları session, audit, policy, rate ve metrik sorgularını verir.
11. Analitik araçları process ve bot durumunu toplar; özet, SVG ve tablo üretir.
12. Telemetri hook'ları action span ve ölçümlerini seçilen sisteme aktarır.

## Tutarlılık

Session ve OAuth state tek kullanımlı olmalıdır. Çoklu instance'ta idempotency, lease ve outbox claim atomik olmalıdır. Yetkili yazmalarda canlı Discord verisi veya gateway olaylarıyla temizlenen cache kullanılmalıdır.

## Şemalar

`docs/uml` klasöründe bileşen, action, transaction, OAuth, realtime, deployment ve analitik Mermaid şemaları bulunur.
