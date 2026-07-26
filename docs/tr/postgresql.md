# PostgreSQL adapter'ı

`createPostgresAdapter()` pool benzeri bir nesne alır. GuildGate `pg` paketini import etmez; istemci sürümünü uygulama seçer.

Adapter session, OAuth state, şifreli credential, rate limit, cache, idempotency, lease, audit, policy, outbox, analitik ve realtime sequence tablolarını kapsar.

## Migration

```bash
npx guildgate-migration --prefix guildgate > guildgate.sql
```

SQL'i inceleyip uygulamanın migration aracıyla çalıştırın. Her instance'ın aynı migration'ı eş zamanlı başlatmasına izin vermeyin.

## Transaction

`AsyncLocalStorage`, transaction içindeki store çağrılarını aynı client üstünde tutar. Dış işlem `BEGIN/COMMIT`, iç işlem benzersiz `SAVEPOINT` kullanır. İç hata kendi savepoint'ine döner. Post-commit callback'leri yalnızca dış commit sonrasında çalışır ve hata verseler de rollback oluşturmaz.

## Session sınırı

Session oluşturma, kullanıcı ID'sine bağlı transaction advisory lock alır; kaydı ekler ve sınırın dışındaki eski kayıtları aynı transaction içinde siler.

## Rate limit

Rate-limit bucket güncellemesi, satırı okumadan ve upsert etmeden önce bucket key üzerinden transaction advisory lock alır. Böylece henüz satırı olmayan bucket'a aynı anda gelen ilk istekler kaybolmaz.

## Idempotency

İlk reservation `INSERT ... ON CONFLICT DO NOTHING` ile alınır. Tamamlama ve temizleme sorguları `state='inflight'` ve `reservationId` koşullarını içerir. Eski worker `false` sonucu alır.

## Audit ve outbox

Audit cursor sorgusu `created_at DESC, id DESC` sırasını kullanır. Outbox worker satırları `FOR UPDATE SKIP LOCKED` ile claim eder. Teslimat at-least-once olduğu için consumer event ID üzerinden deduplication yapmalıdır.

Repository CI'ı geçici PostgreSQL servisiyle transaction, savepoint, reservation, session sınırı ve audit pagination testlerini çalıştırır.
