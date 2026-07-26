# Yapılandırma referansı

GuildGate veri tabanı, route, Discord erişimi ve arayüz kararlarını uygulamaya bırakır.

## Uygulama ve origin

`app` adı, ortamı ve base URL değerini taşır. Production HTTPS ister. Allowed origin listesi localhost, IPv4 loopback, IPv6 loopback, unspecified ve IPv4-mapped loopback adreslerini reddeder. Scheme, host ve port tam eşleşmelidir.

## Owner ve dil

`owners`, owner action'larını kullanabilen Discord kullanıcı ID'lerini içerir. Boş liste owner erişimini kapatır. Varsayılan dil `en` veya `tr` olabilir; mesaj değiştirilse bile hata kodu sabit kalır.

## Session ve cookie

Toplam ömür, idle süre, rotation ve kullanıcı başına session sınırı ayarlanır. Resmi store'lar sınırı atomik uygular. Expired veya revoked session cevabı Fastify, Express ve Hono adapter'larında cookie temizliği üretir.

Production için secure `__Host-` cookie, `/` path ve domain alanı olmadan kullanılmalıdır.

## Store ve transaction

Tam `GuildGateStores` paketi verin veya PostgreSQL ile Redis store'larını `composeStores()` ile birleştirin. Adapter sözleşmesi `1.1`; reservation sahipliği, atomik session create ve cursor audit paging davranışlarını içerir.

Domain kaydı ile mandatory outbox aynı transaction'da yazılmalıdır. Post-commit gözlemci hatası rollback oluşturmaz. `audit.failClosedActions` içinde yer alan action, audit, idempotency ve required transaction kullanmalıdır. Audit store domain yazımıyla aynı transaction'a katılmalıdır.

## Action

Authentication, CSRF, parse, resource, rate, authorization, idempotency, revision, concurrency, retry, circuit breaker, transaction, timeout, cache, realtime ve audit davranışı action başına ayarlanır.

Idempotency TTL, `timeoutMs` değerinden uzun olmalıdır. Retry yalnızca tekrar çalışması güvenli olduğu bilinen hatalara uygulanmalıdır.

## Reliability

`reliability.maximumLateSettlementMs` varsayılan olarak beş dakikadır; 10 milisaniye ile 24 saat arasında ayarlanır. Timeout veya cancellation sonrasında reservation ve lease’in tutulduğu gözlem süresini sınırlar. Bu süre dolduğunda kaynaklar bırakılır. Geç kalan stale worker yazımını engellemek için uygulama `AbortSignal` kullanmalı ve kalıcı yazımda fencing token doğrulamalıdır.

## Realtime ve audit

Mesaj boyutu, rate, kanal uzunluğu, subscription sayısı, idle timeout, lifetime, buffered bytes ve session revalidation sınırları bulunur. WebSocket ve Socket.IO aynı hub kontrollerini kullanır.

Audit redaction listesine uygulamaya özel gizli alanlar eklenebilir. Domain ile atomik olması gereken audit kaydı transaction içinde yazılmalıdır.
