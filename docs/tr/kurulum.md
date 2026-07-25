# Kurulum ve ilk yayın

## 1. Depoyu hazırlama

```bash
unzip guildgate-0.1.0.zip
cd guildgate-0.1.0
npm install
npm test
```

İlk internet bağlantılı geliştirme bilgisayarında `npm install`, `package-lock.json` dosyasını oluşturur. İlk pull request öncesinde bu dosyayı commit edin.

## 2. Yapılandırma kontrolü

`.env.example` dosyasını özel bir ortam dosyasına kopyalayın ve her gizli değer için ayrı rastgele veri üretin.

```bash
node ./bin/guildgate-doctor.mjs
```

Son kontrolde `GUILDGATE_ENVIRONMENT=production` kullanın. Doctor; HTTPS, origin listesi, gizli değer uzunlukları ve token şifreleme anahtarını kontrol eder.

## 3. GitHub deposu

`kavtuai` hesabında `guildgate` adında boş ve herkese açık bir depo oluşturun.

```bash
git init
git branch -M main
git add .
git commit -m "feat: initial GuildGate release"
git remote add origin git@github.com:kavtuai/guildgate.git
git push -u origin main
```

`main` dalı için koruma, zorunlu CI ve CodeQL kontrolü, pull request incelemesi, secret scanning, private vulnerability reporting ve Dependabot özelliklerini açın.

## 4. npm ayarı

Paket adı `@kavtuai/guildgate` olarak tanımlıdır. npm tarafında `kavtuai` scope’u herkese açık scoped paket yayımlayabilmelidir.

npm trusted publishing ayarını bu GitHub deposu ve `.github/workflows/publish.yml` dosyasıyla eşleyin. Bu yapı GitHub OIDC kullanır ve uzun süreli npm tokenı gerektirmez.

Yayın öncesi:

```bash
npm login
npm whoami
npm run pack:check
```

## 5. İlk uygulama bağlantısı

1. Kalıcı ve kısa ömürlü veri sürücülerini seçin.
2. Çekirdeği kurun ve doctor komutunu çalıştırın.
3. Discord OAuth başlangıç ve callback endpoint’lerini ekleyin.
4. Giriş yapmış frontend’e CSRF tokenı veren başlangıç endpoint’ini ekleyin.
5. Bir okuma ve bir idempotent yazma işlemi hazırlayın.
6. Yazma işlemine canlı Discord sunucu yetkisi kontrolü ekleyin.
7. Denetim ve outbox saklama görevlerini hazırlayın.
8. HTTP yetkilendirmesi tamamlandıktan sonra gerçek zamanlı merkezi bağlayın.
9. Rol kaldırma, botu sunucudan çıkarma, oturum iptali, Redis kesintisi, veritabanı zaman aşımı ve çift kayıt senaryolarını test edin.
