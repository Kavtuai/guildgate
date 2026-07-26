# Güvenilir yazma modeli

GuildGate istek güvenliği ile veri tabanı sahipliğini ayırır. Uygulama kendi veri tabanını ve gerektiğinde transaction adapter'ını seçer.

## Sıra

Bir yazma işlemi oturum, origin, CSRF, girdi, politika, limit, yetki, idempotency, revision, lease, transaction, outbox, cache ve audit adımlarından geçebilir.

## Revision kontrolü

İstemci beklediği revision değerini gönderir. Action güncel değeri güvenilir kaynaktan okur. Değerler farklıysa işlem `REVISION_CONFLICT` ile durur. Veri tabanı update sorgusu da revision değerini `WHERE` koşulunda kullanmalıdır.

## Transaction ve hook'lar

Adapter; isolation, read-only ve timeout seçeneklerini alır. Before, before-commit, after-commit ve after-rollback hook'ları vardır. Veri doğruluğu için zorunlu kayıtlar after-commit hook'una bırakılmamalıdır.

## Lease ve fencing token

Yenilenen lease aynı kaynakta iki aktif yazarı sınırlar. Fencing token her yeni sahipte büyür. Veri tabanı eski token ile gelen yazmayı reddederse süresi geçmiş bir process sonradan kayıt yapamaz.

## Commit sonrası işlemler

Cache veya genel audit işlemi domain commit'inden sonra hata verebilir. GuildGate domain işlemini tekrar çalıştırmaz; sorunları `meta.postCommitIssues` alanında bildirir.
