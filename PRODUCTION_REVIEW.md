# GuildGate 1.1.1 ve GuildGate Docs 0.4.0 üretim inceleme raporu

Tarih: 3 Ağustos 2026

## Yönetici özeti

Çalışma yalnızca `@kavtuai/guildgate`, `guildgate.js.org`, doğrulama konsolu ve bunların test/yayın zincirini kapsadı. Başka projelerden kod, environment değişkeni, renk veya mimari taşınmadı.

Paket için önerilen sürüm **1.1.1**'dir. Değişiklikler public adapter/action/realtime contract sürümlerini değiştirmediği ve mevcut public export haritasını koruduğu için patch sürümü uygundur. Dokümantasyon sürümü **0.4.0**'dır; varsayılan locale ve URL davranışı değiştiği için docs tarafında minor sürüm kullanıldı.

Paketin yerel `release:verify` zinciri geçti. Dokümantasyonun kaynak, locale, arama, konsol ve güvenlik kontrolleri geçti. Bu ortamda docs bağımlılıkları public npm registry'den indirilemediği ve docs lockfile'ı mevcut kaynak arşivinde bulunmadığı için gerçek Docusaurus production build'i burada çalıştırılmadı. Hazırlanan kurulum betiği kullanıcının gerçek repository'sinde lockfile'ı güncelleyip `npm ci` ve `npm run validate` geçmeden commit/push yapmaz.

## 1. Tespit edilen proje mimarisi

- npm paketi: tek paketli TypeScript/ESM projesi.
- Runtime bağımlılığı: yok; PostgreSQL, Redis, Discord ve framework istemcileri tüketici uygulama tarafından sağlanıyor.
- Dokümantasyon: ayrı Docusaurus repository'si.
- Paket ve docs birbirinden ayrı sürümleniyor; docs merkezi metadata dosyası üzerinden paket/contract sürümlerini izliyor.

## 2. Dokümantasyon framework'ü ve sürümü

- Docusaurus `3.10.2`
- React `19.2.5`
- `@docusaurus/plugin-client-redirects` `3.10.2`
- Tek domain, iki locale: English `/`, Türkçe `/tr/`

## 3. Paket yöneticisi ve Node.js sürümü

- Paket yöneticisi: npm, lockfile version 3.
- Desteklenen runtime: Node.js 22 ve üzeri.
- Yerel doğrulama runtime'ı: Node.js `v22.16.0`.
- Trusted Publishing workflow'u Node.js 24 ve npm `>=11.5.1` kullanacak şekilde hazırlandı.

## 4. Mevcut GuildGate package API yapısı

- 16 public export yolu korundu.
- 3 CLI hedefi korundu: `guildgate-doctor`, `guildgate-writing-check`, `guildgate-migration`.
- Adapter contract `1.1`, action contract `1.0`, realtime contract `1.0`.
- Runtime dependency eklenmedi.

## 5. Doğrulama konsolunun gerçek veri yolu

- Girdi yalnızca component state içinde tutuluyor.
- Bounded tokenizer ve açık komut allowlist'i kullanılıyor.
- Metin JavaScript olarak yorumlanmıyor.
- Konsol veri yolunda network, browser storage, cookie, IndexedDB, `eval`, `Function`, VM veya process yürütme yok.
- Çıktı React metni olarak render ediliyor; kullanıcı girdisi HTML olarak basılmıyor.

## 6. Bulunan güvenlik sorunları

1. Action biçimli düz nesneler doğrudan kernel'e geçirilebiliyordu. Paket örneğine bağlı branding ve contract doğrulaması eklendi.
2. Bazı operator payload parser'ları fazladan alanları ve tehlikeli obje anahtarlarını kesin reddetmiyordu. Düz obje, alan allowlist'i, tür/limit ve prototype-pollution kontrolü eklendi.
3. npm tarball gereğinden fazla iç dosya ve source map taşıyabiliyordu. Publish allowlist'i daraltıldı, declaration/source map kapatıldı.
4. Publish zinciri doğrulanmış tek artifact'i taşımıyordu. Verify job'un ürettiği tarball publish job'a artifact olarak aktarılıyor.
5. Docs konsol parser'ında giriş/token/flag sınırları ve tehlikeli anahtar reddi açık bir ortak kapıda değildi. Bounded state-machine tokenizer ve limitler eklendi.
6. Docs varsayılan locale Türkçeydi; İngilizce kök ve Türkçe `/tr/` hedefi uygulanmamıştı.
7. Security header iddiaları hosting katmanından bağımsız anlatılabiliyordu. Repository düzeyi ile CDN/reverse-proxy düzeyi ayrıldı.

## 7. Yanlış pozitif olarak değerlendirilen bulgular

- `src/redis.ts` içindeki `eval`, JavaScript `eval` değildir. Redis'in library-owned sabit Lua scriptlerini atomik çalıştıran istemci API'sidir; kullanıcı girdisi script metnine dönüştürülmez.
- `scripts/run-coverage.mjs` ve `scripts/package-inspect.mjs` içindeki `child_process` yalnızca bakım/release kontrolünde kullanılır. Bu dosyalar npm runtime tarball'ına girmez.
- Realtime source içindeki `WebSocket` sözcüğü browser konsolunun ağ erişimi değildir; paket tarafındaki transport interface'idir.

## 8. Değiştirilen dosyalar

Paket çalışma ağacında 26 değişiklik kaydı, docs çalışma ağacında 96 değişiklik kaydı bulunuyor. Tam listeler teslim paketindeki manifest ve aşağıdaki diff eklerinde yer alır.

## 9. Her dosyada yapılan değişiklik

Ana değişiklik grupları:

- `src/action.ts`, `src/kernel.ts`: action branding ve contract kontrolü.
- `src/operator.ts`: strict plain-object/payload doğrulaması.
- `tests/security-hardening.test.mjs`: forged action ve prototype-pollution regresyonları.
- `package.json`, `tsconfig.json`, package kontrol scriptleri: publish allowlist, no sourcemap, release gates.
- `.github/workflows/*`: minimal izinler, CI, verified tarball artifact ve OIDC publish.
- docs locale ağacı, Docusaurus config, arama dizini ve sayfalar: English default, Türkçe `/tr/`, 1.1.1 doğruluğu.
- console engine/checks: parser limitleri, dangerous-key/secret/network/storage/XSS kontrolleri.

## 10. Eklenen veya güncellenen testler

- Forged action object reddi.
- Operator payload fazladan alan ve prototype-pollution anahtarı reddi.
- Console unknown command, boş giriş, uzun giriş, çok satır, çok token/flag, HTML/script, `javascript:`, dangerous key ve secret benzeri değer testleri.
- Packed tarball üzerinden 16 export ve 3 CLI consumer kontrolü.
- Locale parity, metadata, source, search index ve build-output kontrolleri.

## 11. İngilizce varsayılan dil için yapılanlar

- `defaultLocale: 'en'`.
- English root `/`.
- Türkçe `/tr/`.
- `htmlLang: 'en'` ve `htmlLang: 'tr'`.
- Docusaurus default locale üzerinden `x-default`.
- English navbar/footer base config; Türkçe çeviri dosyaları.

## 12. Türkçe URL uyumluluğu

- Türkçe içerik `/tr/` altında aynı doc kimlikleriyle korunur.
- Eski `/en/` adresleri English root karşılığına yönlendirilir.
- Önceki kök Türkçe URL'ler artık English karşılığı açar; aynı path üzerinde hem English default hem eski Türkçe içerik tutulamayacağı için bu semantik değişiklik kaçınılmazdır.
- Yönlendirme zinciri ve `/tr/` üzerine yanlış `/en` redirect üretimi engellendi.

## 13. Paket sürümü ve contract sürümü yönetimi

- Package: `1.1.1` (`package.json` + `package-lock.json`).
- Docs: `0.4.0`.
- Docs merkezi metadata: `src/data/release-metadata.mjs`.
- Contract sabitleri: `src/contracts.ts`.
- Metadata checker README, lockfile, docs ve contract değerleri için release'i durdurur.

## 14. Dependency audit sonucu

- `npm audit --omit=dev --json`: exit code 0, production vulnerability toplamı 0.
- Tam `npm audit --json`: bu çalışma ortamındaki internal registry npm audit endpoint'ine 404 verdi; sonuç **başarılı audit olarak kabul edilmedi**.
- `npm audit fix --force` çalıştırılmadı.

## 15. Lockfile doğrulaması

- Paket lockfile version 3 ve package version `1.1.1` ile eşleşiyor.
- Temiz `npm ci` denemesi internal registry'de `undici-types` tarball 404 nedeniyle exit code 1 verdi.
- Mevcut kurulu bağımlılıklarla tam release zinciri geçti; gerçek GitHub CI public registry + committed lockfile üzerinden yeniden doğrulamalıdır.
- Docs kaynak snapshot'ında lockfile yoktu; installer gerçek repo lockfile'ını günceller ve temiz kurulum geçmeden yayın yapmaz.

## 16. Secret scan sonucu

- Package source-tree secret scan: PASS.
- Docs source-tree secret scan: PASS.
- Değerler rapora basılmadı.
- Gerçek Git geçmişi source ZIP içinde bulunmadığı için geçmiş taraması tamamlanmış sayılmadı; GitHub secret scanning/push protection repository ayarından doğrulanmalıdır.

## 17. Dependabot yapılandırması

- npm ve GitHub Actions haftalık izleniyor.
- Patch/minor TypeScript tooling grubu eklendi.
- Major yükseltmeler otomatik gruba alınmıyor; insan incelemesi gerekiyor.

## 18. GitHub Actions izinleri

- Varsayılan `contents: read`.
- `id-token: write` yalnızca npm publish job'unda.
- Pages build ve deploy izinleri ayrı job'larda.
- Dokümantasyon pull requestleri ayrı `CI` workflow'unda tam `npm run validate` kapısından geçer.
- CodeQL job'u yalnız gerekli `security-events: write` yetkisini alır.

## 19. Trusted Publishing/OIDC durumu

- Workflow kodu hazır.
- Long-lived `NPM_TOKEN`/`NODE_AUTH_TOKEN` kullanılmıyor.
- npm panelinde `Kavtuai/guildgate`, workflow `publish.yml` ve gerekiyorsa environment `npm` eşleştirmesi manuel doğrulanmalıdır.
- Bu dış servis ayarı doğrulanmadan Trusted Publishing tamamlandı denmez.

## 20. Provenance doğrulama durumu

- Public repo + public package + npm Trusted Publishing başarılı olduğunda npm otomatik provenance üretir.
- Kod tarafı hazır; gerçek provenance yalnız 1.1.1 yayımlandıktan sonra npm metadata üzerinden doğrulanabilir.

## 21. `npm pack --dry-run` / pack sonucu

- `npm run pack:inspect`: exit code 0.
- 146 dosya.
- 438.735 byte unpacked.
- Source map, source, test, workflow, `.env`, checksum ve iç rapor bulunmadı.

## 22. Packed tarball içeriği

- Runtime `dist` ve declaration dosyaları.
- 3 CLI.
- Gerekli docs/examples.
- README, Türkçe README, CHANGELOG, LICENSE, SECURITY, MIGRATION ve operating limits.
- 16 export ve 3 CLI boş consumer proje üzerinden doğrulandı.

## 23. Type-check sonucu

- Komut: `npm run typecheck`
- Exit code: 0.

## 24. Lint/format sonucu

- Projede ESLint tanımlı değildi; varmış gibi eklenmedi.
- Komut: `npm run format:check`
- Exit code: 0.
- 69 TypeScript/MJS/JSON dosyası satır sonu, trailing whitespace ve final newline açısından doğrulandı.

## 25. Test sonucu

- Komut: `npm test`
- Exit code: 0.
- 80 test tanımı; 78 pass, 0 fail, 2 live-service skip.

## 26. Package build sonucu

- Komut: `npm run build`
- Exit code: 0.
- `dist` temizlenip TypeScript kaynağından yeniden üretildi.
- Source map ve declaration map üretilmedi.

## 27. Documentation build sonucu

- Kaynak kontrol zinciri: `npm run check`, exit code 0.
- Arama: 68 kayıt; 34 English + 34 Turkish doc.
- Docusaurus production build: bu ortamda çalıştırılmadı; docs dependency lockfile/registry erişimi yoktu.
- Installer, kullanıcı repository'sinde `npm run validate` başarılı olmadan commit/push yapmaz.

## 28. Kırık link kontrolü

- Docusaurus `onBrokenLinks: 'throw'` ve markdown broken-link hook'u etkin.
- Production build çalışmadığı için son HTML link graph sonucu burada PASS olarak işaretlenmedi.
- CI build bu kapıyı zorunlu çalıştırır.

## 29. Production güvenlik başlıkları

- Beklenen CSP, HSTS, frame, referrer, permissions, opener/resource policy değerleri `SECURITY_HEADERS.md` içinde tanımlandı.
- GitHub Pages repository dosyası tek başına bu response header'ları garanti etmez.
- Gerçek CDN/reverse proxy katmanında uygulanmalı ve `npm run verify:production` ile canlı response üzerinden doğrulanmalıdır.

## 30. Tamamlanamayan veya manuel işlem gerektiren noktalar

1. Docs `npm ci` + Docusaurus build: gerçek repo/CI üzerinde.
2. PostgreSQL/Redis live-service testleri: GitHub CI üzerinde.
3. Full development dependency audit: public npm audit endpoint'i üzerinde.
4. Repository geçmişi secret scan/push protection: GitHub ayarlarında.
5. Branch protection ve zorunlu checks: GitHub ayarlarında.
6. npm Trusted Publisher ve environment bağlantısı: npm/GitHub panellerinde.
7. Production security headers: gerçek hosting/CDN katmanında.
8. Provenance: npm publish sonrasında.

## 31. Önerilen semver değişikliği

- npm package: `1.1.0` → `1.1.1` (patch).
- docs site: `0.3.3` → `0.4.0` (minor; default locale/URL davranışı değişiyor).

## 32. Deployment ve npm publish adımları

### Package

1. 1.1.1 kaynak ZIP'ini temiz release branch'ine uygula.
2. `npm ci --ignore-scripts`.
3. `npm run release:verify`.
4. PR aç; Node 22/24, coverage, service integration, load, CodeQL kontrollerini geçir.
5. Main'e merge et.
6. `v1.1.1` tag/release yayımla.
7. GitHub Actions `publish.yml` npm environment onayını geçirip verified tarball'ı yayımlasın.
8. npm version, integrity ve provenance metadata'sını doğrula.

### Docs

1. 0.4.0 installer'ı gerçek `guildgate-docs` repo kökünde çalıştır.
2. Installer eski bilinen 0.3.3 yarım değişikliklerini stash ile korur.
3. Lockfile güncellenir; `npm ci --ignore-scripts` ve `npm run validate` çalışır.
4. Commit/push yalnız tüm kapılar geçerse yapılır.
5. GitHub Pages başarılı olduktan sonra `/`, `/tr/`, `/en/` redirect, search, mobile locale ve live headers doğrulanır.

## Değişiklik ekleri

### Package çalışma ağacı

```text
M .github/dependabot.yml
 M .github/workflows/ci.yml
 M .github/workflows/publish.yml
 M CHANGELOG.md
 M LOAD_TEST_REPORT.json
 M README.md
 M README.tr.md
 M docs/WRITING_STYLE.md
 M docs/research-notes.md
 M docs/setup.md
 M docs/tr/arastirma-notlari.md
 M docs/tr/kurulum.md
 M docs/tr/yazim-kilavuzu.md
 M package-lock.json
 M package.json
 M scripts/security-verify.mjs
 M src/action.ts
 M src/kernel.ts
 M src/operator.ts
 M tests/security-hardening.test.mjs
 M tsconfig.json
?? PRODUCTION_REVIEW.md
?? scripts/format-check.mjs
?? scripts/package-inspect.mjs
?? scripts/release-metadata-check.mjs
?? scripts/secret-scan.mjs
```

### Docs çalışma ağacı

```text
M .github/workflows/deploy-pages.yml
 M CHANGELOG.md
 M docs/araclar/dogrulama-konsolu.mdx
 M docs/baslangic/bes-dakikada-basla.mdx
 M docs/baslangic/ilk-yapilandirma.mdx
 M docs/baslangic/kurulum.mdx
 M docs/baslangic/ornekler.mdx
 M docs/baslangic/sorumluluk-sinirlari.mdx
 M docs/cli/doctor.mdx
 M docs/cli/writing-check.mdx
 M docs/dayaniklilik/audit-outbox-telemetri.mdx
 M docs/dayaniklilik/kilit-retry-circuit-breaker.mdx
 M docs/depolama/bellek-redis.mdx
 M docs/depolama/depo-sozlesmeleri.mdx
 M docs/depolama/kalici-kayitlar.mdx
 M docs/depolama/ozel-depolar.mdx
 M docs/gercek-zamanli/realtime-hub.mdx
 M docs/giris.mdx
 M docs/istek-katmani/action.mdx
 M docs/istek-katmani/framework-bagdastiricilari.mdx
 M docs/istek-katmani/yetkilendirme.mdx
 M docs/katki/yazi-standardi.mdx
 M docs/kimlik/csrf-origin.mdx
 M docs/kimlik/discord-oauth.mdx
 M docs/kimlik/oturumlar.mdx
 M docs/mimari/genel-bakis.mdx
 M docs/mimari/islem-yasam-dongusu.mdx
 M docs/mimari/tehdit-modeli.mdx
 M docs/referans/gecis-ve-surumleme.mdx
 M docs/referans/hatalar-ve-diller.mdx
 M docs/referans/public-api.mdx
 M docs/referans/yapilandirma.mdx
 M docs/sorun-giderme.mdx
 M docs/surum-notlari.mdx
 M docs/uretim/guvenlik-kontrol-listesi.mdx
 M docs/uretim/test-ve-yayin.mdx
 M docusaurus.config.js
 D i18n/en/docusaurus-plugin-content-docs/current.json
 D i18n/en/docusaurus-plugin-content-docs/current/araclar/dogrulama-konsolu.mdx
 D i18n/en/docusaurus-plugin-content-docs/current/baslangic/bes-dakikada-basla.mdx
 D i18n/en/docusaurus-plugin-content-docs/current/baslangic/ilk-yapilandirma.mdx
 D i18n/en/docusaurus-plugin-content-docs/current/baslangic/kurulum.mdx
 D i18n/en/docusaurus-plugin-content-docs/current/baslangic/ornekler.mdx
 D i18n/en/docusaurus-plugin-content-docs/current/baslangic/sorumluluk-sinirlari.mdx
 D i18n/en/docusaurus-plugin-content-docs/current/cli/doctor.mdx
 D i18n/en/docusaurus-plugin-content-docs/current/cli/writing-check.mdx
 D i18n/en/docusaurus-plugin-content-docs/current/dayaniklilik/audit-outbox-telemetri.mdx
 D i18n/en/docusaurus-plugin-content-docs/current/dayaniklilik/kilit-retry-circuit-breaker.mdx
 D i18n/en/docusaurus-plugin-content-docs/current/depolama/bellek-redis.mdx
 D i18n/en/docusaurus-plugin-content-docs/current/depolama/depo-sozlesmeleri.mdx
 D i18n/en/docusaurus-plugin-content-docs/current/depolama/kalici-kayitlar.mdx
 D i18n/en/docusaurus-plugin-content-docs/current/depolama/ozel-depolar.mdx
 D i18n/en/docusaurus-plugin-content-docs/current/gercek-zamanli/realtime-hub.mdx
 D i18n/en/docusaurus-plugin-content-docs/current/giris.mdx
 D i18n/en/docusaurus-plugin-content-docs/current/istek-katmani/action.mdx
 D i18n/en/docusaurus-plugin-content-docs/current/istek-katmani/framework-bagdastiricilari.mdx
 D i18n/en/docusaurus-plugin-content-docs/current/istek-katmani/yetkilendirme.mdx
 D i18n/en/docusaurus-plugin-content-docs/current/katki/yazi-standardi.mdx
 D i18n/en/docusaurus-plugin-content-docs/current/kimlik/csrf-origin.mdx
 D i18n/en/docusaurus-plugin-content-docs/current/kimlik/discord-oauth.mdx
 D i18n/en/docusaurus-plugin-content-docs/current/kimlik/oturumlar.mdx
 D i18n/en/docusaurus-plugin-content-docs/current/mimari/genel-bakis.mdx
 D i18n/en/docusaurus-plugin-content-docs/current/mimari/islem-yasam-dongusu.mdx
 D i18n/en/docusaurus-plugin-content-docs/current/mimari/tehdit-modeli.mdx
 D i18n/en/docusaurus-plugin-content-docs/current/referans/gecis-ve-surumleme.mdx
 D i18n/en/docusaurus-plugin-content-docs/current/referans/hatalar-ve-diller.mdx
 D i18n/en/docusaurus-plugin-content-docs/current/referans/public-api.mdx
 D i18n/en/docusaurus-plugin-content-docs/current/referans/yapilandirma.mdx
 D i18n/en/docusaurus-plugin-content-docs/current/sorun-giderme.mdx
 D i18n/en/docusaurus-plugin-content-docs/current/surum-notlari.mdx
 D i18n/en/docusaurus-plugin-content-docs/current/uretim/guvenlik-kontrol-listesi.mdx
 D i18n/en/docusaurus-plugin-content-docs/current/uretim/test-ve-yayin.mdx
 D i18n/en/docusaurus-theme-classic/footer.json
 D i18n/en/docusaurus-theme-classic/navbar.json
 M package.json
 M scripts/build-search-index.mjs
 M scripts/command-engine-check.mjs
 M scripts/editorial-check.mjs
 M scripts/site-check.mjs
 M scripts/source-check.mjs
 M sidebars.js
 M src/data/search-index.json
 M src/lib/command-engine.mjs
 M src/pages/index.js
?? .github/dependabot.yml
?? .github/workflows/ci.yml
?? .github/workflows/codeql.yml
?? SECURITY_HEADERS.md
?? i18n/tr/
?? scripts/build-output-check.mjs
?? scripts/console-security-check.mjs
?? scripts/locale-check.mjs
?? scripts/release-metadata-check.mjs
?? scripts/secret-scan.mjs
?? scripts/verify-deployed-site.mjs
?? src/data/release-metadata.mjs
```

## Resmî kaynaklar

- npm Trusted Publishing: https://docs.npmjs.com/trusted-publishers/
- GitHub OIDC: https://docs.github.com/en/actions/reference/security/oidc
- GitHub workflow permissions: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
- Docusaurus i18n config: https://docusaurus.io/docs/api/docusaurus-config
- Docusaurus i18n deployment: https://docusaurus.io/docs/i18n/tutorial
