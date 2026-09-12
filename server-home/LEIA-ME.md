# 🏠 Servidor de Casa — YTGrab Web

Faz o **seu PC** virar o servidor de downloads do site. Como o IP da sua
casa é "residencial", o YouTube **nunca bloqueia** — é o mesmo princípio
que faz o app de desktop funcionar.

## Como usar (3 passos)

1. Crie um arquivo **`token.txt`** nesta pasta e cole dentro seu token do
   GitHub (é só pra avisar o site que seu PC está online).
2. Dê **dois cliques** em `Iniciar-Servidor.bat`.
   - Na 1ª vez ele baixa `yt-dlp.exe` e `cloudflared.exe` sozinho (~70 MB).
   - Ele abre um túnel público gratuito e avisa o site automaticamente.
3. Pronto! Enquanto a janelinha ficar aberta, quem abrir o site vai baixar
   **qualquer vídeo** pelo seu PC. Fechou a janela, o site volta a usar os
   servidores públicos sozinho (ninguém precisa configurar nada).

## Notas

- Áudio sai em M4A (mesma qualidade do MP3, sem precisar de ffmpeg).
- O túnel usa a **sua** internet: vídeos pesados consomem seu upload.
- Não rode 24/7 se sua conexão for limitada — use quando quiser.
- O token no `token.txt` fica só no seu PC (não publique este arquivo).
