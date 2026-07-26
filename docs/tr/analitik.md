# İzleme ve analitik

GuildGate ölçüm toplama, özetleme ve gösterim parçaları sağlar. Panel çatısını ve saklama süresini uygulama seçer.

## Status monitor

`StatusMonitor` process ölçümlerini, Discord bot durumunu ve uygulama probe'larını belirli aralıkla toplar. Aynı anda iki örnekleme çalıştırmaz.

Toplanan temel değerler bellek, CPU süresi, event-loop gecikmesi, uptime, bot hazır olma durumu, gateway gecikmesi, sunucu sayısı, kullanıcı erişimi, shard ve komut sayısıdır.

## Veri saklama

`MemoryAnalyticsStore` test içindir. PostgreSQL adapter'ı dimension içeren zaman serisi kayıtlarını saklar. Uygulama başka bir metrik sistemine kendi adapter'ını yazabilir.

## Grafikler

- line SVG: zaman serisi
- bar SVG: gruplu karşılaştırma
- donut SVG: küçük parça/bütün görünümü

`buildAnalyticsTable()` başlık, sütun ve satır modeli döndürür. Bu model JSON API veya herhangi bir arayüz çatısında kullanılabilir.

## Önerilen panel değerleri

Gateway p95, event-loop gecikmesi, heap/RSS, bot durumu, shard, sunucu sayısı, API ve veri tabanı probe'u, action hata sayısı, rate limit reddi, outbox birikimi ve aktif session sayısı izlenebilir.
