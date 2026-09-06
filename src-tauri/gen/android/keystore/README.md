# Keystore de release (Android)

Este keystore assina o APK de release do YTGrab no CI (GitHub Actions).

- Arquivo: `ytgrab-release.keystore` (PKCS12, RSA-2048)
- Alias: `ytgrab`
- Senha: `ytgrab-release` (também em `password.txt`)
- Validade: 10.000 dias

O workflow `.github/workflows/build.yml` usa `apksigner` (build-tools) para
assinar o `app-universal-release-unsigned.apk` gerado pelo `tauri android build`.

> Nota: este repositório não publica na Google Play. Se um dia publicar,
> crie um keystore novo, mantenha-o como secret do repositório e use o
> Play App Signing.
