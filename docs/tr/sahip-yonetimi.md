# Sahip yönetimi

Çekirdeğin `owner` metotları uygulama içi API’dir. HTTP isteğini kendi başına kontrol etmez. Bu metotları yalnızca sahip oturumu isteyen `action()` tanımları içinden çağırın.

Sahip işlemlerinde de origin, CSRF, rate limit, idempotency ve denetim kaydı kullanılmalıdır. Bakım modu, kullanıcı veya sunucu engeli ve oturum iptali için işlem nedeni denetim kaydına eklenmelidir.

Salt okunur sahip ekranı `gate.sessions.list(userId)` ve sürücü destekliyorsa `gate.config.stores.audit.list()` kullanabilir. Oturum hash’i, OAuth ciphertext, ham IP veya exception stack bilgisi tarayıcıya döndürülmemelidir.
