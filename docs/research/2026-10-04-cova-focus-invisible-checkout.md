# Cova: fokus gap, USP, invisible checkout, dan validasi pasar

4 Oktober 2026. Ini memo keputusan produk dan riset, bukan klaim PMF atau spesifikasi fitur yang sudah disetujui untuk implementasi. Source aplikasi/kontrak diperiksa pada main99efa29. Perubahan lokal lain dipertahankan.

## Rekomendasi arah

Cova menjadi checkout tertanam untuk layanan berbayar per sesi: dana tersedia sebelum layanan dimulai, harga mengikuti aturan yang disetujui, dan saldo yang tidak terpakai kembali tersedia untuk customer. Target awal adalah developer platform digital yang sudah menerima stablecoin dan membayar biaya resource sebelum mengetahui total tagihan customer.

Mulai dari satu integrasi layanan berdasarkan durasi, seperti akses workspace/mesin komputasi sementara. Ini hipotesis segmen awal, bukan bukti bahwa provider tersebut sudah meminta Cova. Pilihan ini membuat pengukuran/tagihan lebih mudah diuji daripada langsung menghubungkan hardware EV charging. Cova tetap infrastruktur pembayaran; tidak perlu menjadi penyedia cloud atau marketplace.

## Gap utama: invoice tidak mengamankan dana

Invoice menyatakan berapa yang harus dibayar. Invoice yang belum dibayar tidak dengan sendirinya mengunci dana. Jika layanan sudah mengonsumsi resource, kegagalan pembayaran menjadi risiko penyedia.

Authorization hold mengamankan dana sebelum layanan berjalan. Ini masuk akal ketika: biaya layanan berjalan sebelum pembayaran final, total akhir belum diketahui, customer baru tidak memiliki fasilitas kredit, atau customer memerlukan batas pengeluaran yang tegas.

Tagihan biasa tetap pilihan baik untuk harga tetap yang dibayar di depan, customer tepercaya dengan termin pembayaran, dan situasi di mana non-payment tidak menimbulkan kerugian berarti. Cova tidak perlu dipakai pada semua pembayaran.

[Stripe mendokumentasikan hold yang menjamin amount sebelum capture](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method), termasuk penggunaan pada hotel. [Model usage-based Stripe](https://docs.stripe.com/billing/subscriptions/metered-billing/thresholds) menjelaskan billing sesudah pemakaian dan kemungkinan akumulasi usage memengaruhi status pembayaran. Ini bukti kebutuhan mekanisme di industri; bukan bukti bahwa merchant ingin mengganti sistem tersebut dengan Cova.

## Tiga value proposition dalam satu produk

| Pihak | Janji produk yang dituju | Bukti dan status Cova |
|---|---|---|
| Provider | Mulai layanan ketika dana sudah benar-benar dicadangkan; settle setelah sesi selesai | Mekanisme hold/capture dikenal di industri. Accounting dan izin dasar tersedia di Cova; service integration belum ada. |
| Customer | Menyetujui tarif serta budget sebelum mulai; mendapatkan tagihan yang dapat dijelaskan dan sisa saldo yang dapat diambil | Cap dan available/reserved tersedia. Tarif/durasi belum ditegakkan kontrak; capture masih amount pilihan merchant. |
| Developer | Embed checkout dan satu lifecycle session, dengan gas/settlement/recovery ditangani di belakang layar | SDK dan authorization signature tersedia. Hosted relayer, account abstraction, session engine, idempotent billing dan worker belum ada. |

Keunggulan yang layak diuji adalah paket pengalaman spesifik ini, bukan klaim menemukan auth/capture atau gas sponsorship. [Commerce Payments Protocol juga memakai operator untuk membayar gas dan menggerakkan lifecycle](https://github.com/base/commerce-payments/security). Pembeda Cova harus dibuktikan melalui penggunaan, kualitas integrasi, dan kebutuhan segmen yang dipilih.

## Kenapa masih ada maksimum

Maksimum adalah budget yang customer izinkan dan jaminan dana yang tersedia. Maksimum bukan invoice akhir. Interface dapat menampilkannya sebagai durasi/budget layanan, bukan form teknis hold.

Contoh ilustratif:

- Tarif0.50 USDG/menit.
- Budget20 USDG, setara maksimum40 menit menurut tarif tersebut.
- Sesi berakhir setelah28 menit: charge14 USDG, sisa6 USDG.

Budget menentukan kapan layanan harus berhenti atau meminta persetujuan tambahan. Kalau seluruh biaya sudah diketahui, customer bisa cukup menyetujui harga pasti. Unknown-final-price bukan syarat mutlak hold; penundaan capture sampai fulfillment juga merupakan kasus sah, tetapi bukan fokus pertama yang dipilih di memo ini.

Tarif dan aturan pembulatan harus terikat ke persetujuan customer. Untuk durasi berbasis state onchain, perhitungan dapat diperiksa secara deterministik. Durasi hak akses bukan bukti mesin benar-benar memberi layanan sepanjang waktu itu. CPU/kWh yang dilaporkan pihak lain juga tetap membutuhkan sumber data dan trust model yang jelas. Jangan mengganti kontrol cap yang lemah dengan klaim oracle yang tidak ada.

## Invisible berarti operasi teknis yang diabstraksikan

Yang bisa ditangani aplikasi: chain configuration, urutan approve/deposit/reserve, submission signature, gas sponsorship, capture/release, retry, dan recovery expiry.

Yang harus tetap terlihat: merchant/provider, tarif, budget, deadline/aturan penghentian, saldo yang dicadangkan, amount yang dibayar, dan cara mengambil sisa. Customer tetap memberi persetujuan; tidak ada spending authority tersembunyi atau allowance unlimited secara diam-diam.

V2 saat ini sudah mendukung customer sign lalu relayer submit untuk saldo yang sudah didanai. Signature tidak membayar gas dan belum mengunci dana sebelum submission dikonfirmasi. Funding approve/deposit dengan EOA tetap membutuhkan transaksi customer.

Full no-ETH-customer flow memerlukan smart account, batching dan sponsor gas yang benar-benar mendukung Arbitrum Sepolia. [ERC-4337 menyediakan dasar untuk atomic multi-operation serta paymaster yang membayar gas](https://eips.ethereum.org/EIPS/eip-4337). Itu dasar kelayakan teknis, bukan klaim provider tertentu sudah terintegrasi dengan Cova. ERC1271 tersedia di vault, sedangkan wallet onboarding/paymaster belum tersedia. Gas dibayar pihak lain, tidak hilang.

## Flow end-to-end yang dituju

```text
Customer membuka layanan provider
→ melihat tarif, budget, dan ketentuan
→ memberi persetujuan pembayaran
→ aplikasi memastikan funding dan confirmed reservation
→ provider baru memulai layanan
→ pemakaian/durasi serta biaya ditampilkan
→ customer berhenti atau budget tercapai
→ backend menyelesaikan amount final dan melepas sisa
→ customer menerima receipt dan saldo yang dapat diambil
```

Untuk returning customer yang sudah funded, tidak perlu menu Deposit dan Authorize Hold terpisah. Untuk customer baru, funding tetap harus nyata. Login/email atau smart wallet tidak otomatis menciptakan USDG.

Dalam v2, release mengembalikan sisa ke available Cova. Transfer ke wallet luar memerlukan withdraw oleh customer. Jika desain nanti menjanjikan auto-return ke wallet, perlu jalur withdrawal/payout yang diotorisasi customer; jangan menyebut release sebagai wallet refund sekarang.

Service harus ditolak sebelum start jika reservation belum confirmed. Settlement perlu memiliki operation/session ID yang tahan retry; nonce signature tidak otomatis mencegah duplicate partial capture. Capture dan release sekarang adalah dua transaksi. Penyelesaian final yang atomik dapat ditambahkan, tetapi bukan USP eksklusif.

## Pertimbangan tiap perspektif

| Perspektif | Pekerjaan yang perlu dipermudah | Alasan untuk menolak Cova |
|---|---|---|
| Customer | Memulai layanan dan memahami tagihan tanpa mengurus gas/kontrak | Tidak punya USDG, tidak mau prefund, atau biaya funding lebih besar dari manfaat |
| Merchant/provider | Kepastian dana, rekonsiliasi sesi, penanganan kegagalan pembayaran | Customer sudah membayar di muka dengan metode yang lebih sederhana |
| Developer | Integration lifecycle, callbacks, retries dan receipt | Alternatif sudah menawarkan integration yang lebih mudah/andal |
| Operator Cova | Reliability, sponsor gas, funding, dan observability | Biaya per transaksi melebihi pendapatan dari integrator |
| Pasar | Provider dengan pengguna yang siap menggunakan stablecoin | Harus memaksa pengguna kartu/QRIS mengubah perilaku tanpa manfaat jelas |

Monetisasi merupakan hipotesis: integrator dapat membayar untuk layanan automation/reliability. Kontrak saat ini tidak memungut protocol fee. Jangan memasukkan fee yang belum ada ke traction atau revenue.

## PMF dan traction: apa yang sudah terbukti

Terbukti secara teknis: source dan deployment v2, accounting/signature tests, integrasi Anvil/fork, serta production read checks.

Baseline RPC pada4 Oktober2026: dari creation block315667402 sampai315682993, scan lengkap menemukan0 HoldCreated,0 alamat customer,0 alamat merchant pada events tersebut. Pembacaan totalLiability juga0. Ini baseline aktivitas publik; wallet/transaction counts sendiri bukan bukti customer berbayar atau PMF.

Belum ada bukti dalam project ini tentang paying customer, external integration yang memakai Cova secara berulang, willingness to pay, atau retention. Aktivitas testnet menunjukkan perilaku/kelayakan teknis, bukan revenue karena test USDG tidak bernilai finansial.

## Eksperimen validasi yang disarankan

Angka berikut adalah target eksperimen, bukan hasil dan bukan ambang universal PMF:

1. Wawancarai5 calon integrator yang saat ini menjual layanan berbasis pemakaian dan menerima/ingin menerima stablecoin. Cari contoh kegagalan pembayaran atau pekerjaan refund/reconciliation yang benar-benar terjadi.
2. Minta2 integrator mencoba integration sendiri. Ukur waktu sampai first completed session, langkah manual, biaya gas/operator, dan lokasi kegagalan onboarding.
3. Targetkan10 sesi pilot yang benar-benar selesai, identifikasi team-generated demo versus pemakaian eksternal, lalu periksa apakah integrator menggunakan kembali tanpa dorongan tim.
4. Minta bukti willingness to pay seperti kesepakatan pilot berbayar. LOI atau pujian dicatat sebagai minat, bukan revenue. Testnet bukan pembayaran komersial.

Funnel minimal: quote viewed → consent → funding ready → hold confirmed → service started → settled → unused balance recoverable → repeat usage. Denominator dan cohort harus jelas. Track kegagalan funding terpisah dari kegagalan produk, dan capture/release retry terpisah dari user cancellation.

Kriteria berhenti/ubah arah: calon integrator tidak mengalami pain tersebut, tidak menginginkan USDG, tidak mau prefund, atau solusi bestaande lebih murah/mudah setelah perbandingan yang nyata. Tujuan eksperimen adalah memilih produk, bukan mengumpulkan angka agar terlihat ramai.

## Paxos: activation blocker, bukan bukti kegagalan vault

Frontend sekarang melabeli link “Get test USDG”, tetapi href menuju panduan docs. Tautan faucet resmi langsung adalah [faucet.paxos.com](https://faucet.paxos.com/), yang juga ditautkan oleh [website resmi Paxos](https://www.paxos.com/pyusd). [Panduan Paxos](https://docs.paxos.com/guides/developer/fund-sandbox-with-test-crypto) menyebut faucet sebagai sumber test asset.

User melaporkan akses memerlukan VPN. Fetch docs pada tool mengembalikan403 atau gagal; inspeksi browser faucet tidak berhasil. Penyebab blokir ISP, geo restriction, WAF, atau DNS belum ditentukan. Tidak ada klaim bahwa semua akses dari Indonesia terblokir atau bahwa faucet Arbitrum berhasil diuji pada sesi ini.

Vault dan frontend data path berinteraksi dengan RPC/token contract. Mereka tidak membutuhkan HTTP docs Paxos untuk approve/deposit/capture bila wallet sudah memiliki token. Karena itu, docs yang tidak bisa dibuka tidak dengan sendirinya berarti token contract tidak dapat dipakai. Dependensi issuer token/transfer restrictions dan dependensi funding tetap harus diperiksa secara terpisah.

Perbaikan onboarding yang perlu dilakukan:

- Link langsung ke faucet dengan instruksi USDG dan network yang benar; jangan mengklaim request berhasil hanya karena halaman dibuka.
- Letakkan panduan ringkas di Cova: network421614, alamat token resmi, serta pemisahan USDG dari ETH gas. User tidak harus membaca dokumentasi panjang di situs lain.
- Sediakan jalur demo dengan wallet yang sudah memiliki USDG resmi atau token dikirim anggota tim dari sumber resmi. Itu prefunding nyata, bukan mint token pengganti atau angka saldo palsu.
- Untuk production, buktikan funding yang sesuai target pengguna/negara tanpa menuntut VPN sebagai langkah normal. Faucet testnet bukan strategi onboarding production.

## Urutan kerja setelah arah dipilih

P0: pastikan funding resmi dan satu funded public two-wallet payment flow.

P1: satu reference integration session dengan quote, consent, actual reservation, start/stop, itemized receipt dan recovery. Bagian yang bergantung pada merchant/offchain data diberi label yang jujur.

P2: automatic relaying, idempotent settlement, final capture/release dan expiry worker agar operasi merchant tidak manual.

P3: tarif/aturan settlement yang benar-benar enforced serta smart wallet/paymaster untuk onboarding penuh. Prioritas antara pricing policy dan account abstraction diputuskan dari pain pilot. Vault immutable; perubahan aturan dapat memerlukan contract/adapter baru.

Scope tetap tidak memerlukan NFT, governance, yield, cross-chain, marketplace atau AI. Tidak ada fitur yang dibangun atau provider eksternal yang diaktifkan oleh memo ini.
