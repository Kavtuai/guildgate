# Kurulum, tüketici testi ve yayın

## Kaynak arşivini kurma

```bash
unzip GuildGate-1.1.1-kavtuai.zip
cd guildgate-1.1.1
npm ci
npm run release:verify
```

Node.js 22 veya daha yeni bir sürüm kullanın. CI ve katkı veren makinelerin aynı geliştirme bağımlılıklarını kurması için `package-lock.json` dosyasını depoda tutun.

## Uygulamaya ekleme

Bir uygulama yayımlanmış paketi npm üzerinden kurar:

```bash
npm install @kavtuai/guildgate
```

Fastify, Hono, PostgreSQL istemcisi, Redis istemcisi, `ws` ve discord.js gibi çalışma zamanı bağımlılıkları uygulama tarafından seçilir.

## Ortam kontrolü

`.env.example` dosyasını özel bir ortam dosyasına kopyalayın ve her gizli değer için ayrı rastgele veri üretin.

```bash
node ./bin/guildgate-doctor.mjs
```

Dağıtım kontrolünde `GUILDGATE_ENVIRONMENT=production` kullanın. Bu mod HTTPS, izinli origin listesi, gizli değer uzunlukları ve token şifreleme anahtarı biçimini denetler.

## Veri sürücüsü seçimi

- Test ve tek process geliştirme için memory store
- Paylaşılan kısa ömürlü kayıtlar için Redis store
- Kalıcı kayıtlar, transaction, analitik, realtime sequence ve outbox claim için yerleşik PostgreSQL adapteri
- `runStoreContract()` testini geçen özel sürücüler

PostgreSQL SQL çıktısını uygulamadan önce inceleyin:

```bash
npx guildgate-migration --prefix guildgate > guildgate.sql
```

Şema değişikliklerini her process açılışında otomatik çalıştırmak yerine uygulamanın migration sistemiyle yönetin.

## Temiz tüketici testi

```bash
mkdir guildgate-consumer-test
cd guildgate-consumer-test
npm init -y
npm install /paket/yolu/kavtuai-guildgate-1.1.1.tgz
node -e "import('@kavtuai/guildgate').then(m => console.log(typeof m.createGuildGate))"
npx guildgate-doctor --help
npx guildgate-migration --help
```

Import komutu `function` yazmalı; CLI komutları hata vermeden kapanmalıdır.

## Uygulamaya bağlama sırası

1. Store ve transaction sahipliğini seçin.
2. Çekirdeği kurun ve doctor komutunu çalıştırın.
3. Discord OAuth başlangıç ve callback endpoint’lerini ekleyin.
4. Oturuma bağlı CSRF tokenını kimliği doğrulanmış başlangıç endpoint’iyle verin.
5. Bir okuma ve bir idempotent yazma işlemi hazırlayın.
6. Korumalı işlemlere canlı kullanıcı ve bot sunucu yetkisi ekleyin.
7. Aynı kaydı birden fazla kişi değiştirebiliyorsa revision kontrolü kullanın.
8. Birlikte commit edilmesi gereken domain kaydı ve outbox olayı için transaction adapteri kullanın.
9. Denetim, outbox, analitik ve realtime kayıtlarına retention ekleyin.
10. HTTP yetkilendirmesi bittikten sonra WebSocket, Socket.IO veya SSE bağlayın.
11. Operator işlemlerini yalnızca açık owner yetkisi arkasında sunun.
12. Rol kaybı, botun çıkarılması, session iptali, Redis kesintisi, veritabanı zaman aşımı, çift yazma ve reconnect cursor senaryolarını test edin.

## GitHub ve npm yayını

`main` dalını koruyun; CI ve CodeQL kontrollerini zorunlu yapın. Yayını GitHub Release üzerinden npm Trusted Publisher/OIDC ile çalıştırın. Güven ilişkisi kurulduktan sonra iş istasyonundan doğrudan npm yayını kapalı tutulmalıdır.

Yayın öncesi:

```bash
npm run release:verify
npm pack --json
```

Tag değeri `v` ile `package.json` sürümünün birleşimi olmalıdır. Paket sürümü `npm run release:verify` kontrolünden geçmeli ve release tag değeriyle birebir eşleşmelidir. Bakımcı inceleme dosyaları kaynak depoda kalır; npm tarball içine alınmaz.
