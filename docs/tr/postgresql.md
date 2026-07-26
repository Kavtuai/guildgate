# PostgreSQL adapter'ı

`createPostgresAdapter()` pool benzeri bir nesne alır. GuildGate `pg` paketini doğrudan import etmez; sürümü uygulama belirler.

Adapter session, OAuth, credential, rate limit, cache, idempotency, lease, audit, policy, outbox, analitik ve realtime sequence tablolarını kapsar.

Migration SQL'i:

```bash
npx guildgate-migration --prefix guildgate
```

SQL'i inceleyip uygulamanın migration aracıyla çalıştırın. Her instance'ın aynı anda otomatik migration başlatmasına izin vermeyin.

Outbox worker'ları satırları claim eder. Başarılı yayın tamamlanır, hata alan claim süresi sonunda yeniden alınabilir. Teslim kodu tekrar çalışmaya dayanıklı olmalıdır.
