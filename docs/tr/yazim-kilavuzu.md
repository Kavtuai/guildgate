# Yazım kuralları

Bu dosya GuildGate belgeleri, hata metinleri, örnekler, sürüm notları ve depo sayfaları için yazım kurallarını belirler.

Kontrol listesi, 25 Temmuz 2026 tarihinde incelenen Wikipedia **Signs of AI writing** sayfasındaki başlıklardan hazırlanmıştır. Sayfa, bu işaretlerin kesin kanıt olmadığını belirtir. GuildGate bu listeyi yazar tespiti için değil, metin düzenleme kontrolü için kullanır.

Kaynak: https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing

## İçerikten çıkarılacak kalıplar

1. **Dayanaksız önem yükleme.** Küçük bir fonksiyonun sektörü değiştirdiği, kalıcı miras bıraktığı veya geniş bir dönüşümün parçası olduğu kanıt olmadan yazılmaz.
2. **Tanınmışlık doldurması.** Basın, uzmanlar veya topluluklardan söz edilecekse kaynak adı ve desteklediği bilgi belirtilir.
3. **Yüzeysel yorum.** Bir teknik gerçeğe genel anlam eklemek yerine istek, oturum, kayıt veya yönetici üzerindeki etkisi açıklanır.
4. **Reklam dili.** Teknik bölümde övgü yerine davranış, sınır ve ödünleşim yazılır.
5. **Belirsiz kaynak.** “Birçok geliştiriciye göre”, “genel olarak bilinir” veya “uzmanlar katılıyor” gibi cümleler kaynak yoksa kaldırılır.
6. **Hazır gelecek bölümleri.** Projeye özel iş, sorumlu ve kabul ölçütü yoksa “Zorluklar ve gelecek” bölümü eklenmez.
7. **Konu adını sürekli tekrarlama.** Genel kavramlar özel ad gibi her paragrafta yinelenmez.
8. **Kanıtsız eğilim.** Artan talep, hızlı benimsenme veya değişen sektör beklentisi gibi ifadeler güncel kaynak olmadan kullanılmaz.

## Kelime ve cümle kontrolleri

Aşağıdaki İngilizce kelimeler tek başına yasak değildir. Somut bir işlevi saklıyorsa daha açık fiille değiştirilir:

- additionally
- align with
- boasts
- bolstered
- crucial
- delve
- emphasizing
- enduring
- enhance
- fostering
- garner
- highlight
- interplay
- intricate
- key
- landscape
- meticulous
- pivotal
- robust
- showcase
- tapestry
- testament
- underscore
- valuable
- vibrant

Ayrıca şu alışkanlıklar temizlenir:

- “Olmak”, “sahip olmak” veya “yapmak” gibi açık fiillerden kaçıp süslü fiil kullanmak.
- Anlam gerektirmediği hâlde “yalnızca X değil, aynı zamanda Y”, “X değil Y” veya “X yerine Y” karşıtlığı kurmak.
- Cümleyi tamamlanmış göstermek için üç sıfat, üç fayda veya üç yan cümle eklemek.
- Aynı sözcüğü tekrar etmemek uğruna zorlanmış eş anlamlılar kullanmak.
- Paragrafa hazır giriş cümlesiyle başlamak.
- Bölümü yeni bilgi vermeyen özet cümlesiyle kapatmak.

## Biçim kontrolleri

- Her kelimesi büyük harfle başlayan İngilizce başlıklar.
- Normal kelimeleri veya hemen her maddeyi kalın yazmak.
- İçeriği zayıf, kalın mini başlıklardan oluşan dikey listeler.
- Virgül veya nokta yeterliyken sık uzun çizgi kullanmak.
- Teknik belge, hata, changelog veya güvenlik metninde süs emojisi.
- Az veriyi büyük göstermek için tablo kullanmak.
- Kod veya komuta kıvrımlı tırnak kopyalamak.
- Başlık seviyelerini atlamak.
- Her başlıktan önce yatay çizgi eklemek.
- Markdown göstermeyen alana Markdown yapıştırmak.

## Kullanıcıya konuşan hazır metinler

Yayımlanmış dosyada asistan konuşması bulunmaz:

- Devam etme, genişletme veya başka bir konuda yardım teklifleri.
- Bilgi kesim tarihi açıklamaları.
- Okuyucunun ne isteyebileceğine ilişkin tahminler.
- “İşte düzenlenmiş sürüm”, “elbette” veya “umarım yardımcı olur” gibi çerçeve cümleleri.
- `[isim ekle]`, `[kaynak ekle]` veya `TODO` biçiminde boş yerler.
- Şablon talimatları.
- Prompt, üretim yöntemi veya ret açıklaması.

## Reddedilecek işaretleme ve kaynak kalıntıları

Yayın kontrolü şunları bulmalıdır:

- Bozuk Markdown kod blokları, bağlantılar, referanslar veya HTML parçaları.
- Markdown dosyasında wiki işaretlemesi.
- `contentReference`, `oaicite`, `turn0search`, `attributableIndex` veya `+1` gibi model içi kaynak dizgileri.
- Gemini citation span, Grok card, DeepSeek dagger, Perplexity yükleme referansı veya `:::writing` bloğu.
- Var olmayan şablon, kategori, dosya, import, komut, ortam değişkeni veya paket export’u.
- Kaynak bağlantısında `utm_source` gibi takip parametreleri.
- Açılmayan ya da yanındaki cümleyi desteklemeyen DOI, ISBN, paket veya belge bağlantısı.
- Tanımlanıp kullanılmayan kaynaklar.

## Depoya özel kurallar

1. Her dosyada tek dil kullanılır. `README.md` İngilizce, `README.tr.md` Türkçedir.
2. İşlemi yapan adlandırılır. Uygun olduğunda “sistem” yerine çekirdek, sürücü, uygulama, Discord veya yönetici yazılır.
3. Hata adı belirtilir. “Bir sorun oluştu” yerine `CSRF_INVALID`, `RATE_LIMITED` veya gerçek koşul yazılır.
4. Garanti ve öneri ayrılır. “Üretimde HTTP origin reddedilir” garantidir. “Birden fazla instance için Redis kullanın” öneridir.
5. Sorumluluk belirtilir. Transaction, şema göçü, proxy güveni, gizli değer saklama ve yedekleme, GuildGate açıkça uygulamadıkça uygulamaya aittir.
6. Mutlak güvenlik iddiası kullanılmaz. “Kırılamaz”, “sıfır risk”, “tam güvenli” veya “hatasız” yazılmaz.
7. Örnekler derlenebilir olmalı veya sözde kod olduğu açıkça belirtilmelidir.
8. Örnekteki her ortam değişkeni `.env.example` dosyasında bulunmalı ya da örneğin yanında açıklanmalıdır.
9. Belgede kullanılan her public export, `package.json` ve derlenmiş tip dosyalarında bulunmalıdır.
10. Paragraflar taranabilir tutulur; tek cümle sırf görünüm için madde listesine bölünmez.

## Sürüm öncesi kontrol

- Yukarıdaki kelimeler depoda aranır ve her eşleşme incelenir.
- Model kaynak kalıntıları ve boş köşeli parantezler aranır.
- Bağlantılar, kod örnekleri, testler, tip kontrolü, paket dry-run ve doctor komutu çalıştırılır.
- Değişen her sayfa bir kez düzenleme yapmadan okunur. Davranışı açıklamadan önem iddiası kuran cümleler işaretlenir.
- İnceleyen kişiden “insan gibi duruyor mu” değil, doğru ve sınanabilir olup olmadığını kontrol etmesi istenir.
